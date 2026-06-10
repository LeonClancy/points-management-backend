import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/database.js';
import { createMigrationDb, migrateToLatest } from '../../src/db/migrate.js';
import type { DbExecutor } from '../../src/db/transaction.js';
import {
  captureReservation,
  rechargePoints,
  reserveActionPoints
} from '../../src/modules/points/point.service.js';
import { failParentTransaction } from '../../src/modules/points/parent-transaction.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

async function resetTables(db: DbExecutor): Promise<void> {
  await sql`
    truncate table outbox_events, point_ledger_entries, point_transactions, wallets
    restart identity cascade
  `.execute(db);
}

async function createParentTransaction(db: ReturnType<typeof createDb>, userId: string) {
  const wallet = await db
    .selectFrom('wallets')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();

  return db
    .insertInto('point_transactions')
    .values({
      wallet_id: wallet.id,
      operation: 'ACTION',
      status: 'RESERVED',
      amount: 1,
      idempotency_scope: `parent:${userId}`,
      idempotency_key: randomUUID(),
      request_hash: randomUUID(),
      response_payload: null
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function countReleaseEntries(db: DbExecutor): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count
    from point_ledger_entries
    where entry_type = 'RELEASE'
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

describeWithDb('parent transaction handling', () => {
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const migrationDb = createMigrationDb(databaseUrl!);
    try {
      await migrateToLatest(migrationDb);
    } finally {
      await migrationDb.destroy();
    }

    db = createDb(databaseUrl!);
  });

  beforeEach(async () => {
    await resetTables(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('stores the parent transaction id on child reservations', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'parent-link-recharge'
    });
    const parent = await createParentTransaction(db, userId);

    const child = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'child-linked',
      parent_transaction_id: parent.id,
      idempotency_key: 'child-linked-reserve'
    });

    const transaction = await db
      .selectFrom('point_transactions')
      .selectAll()
      .where('id', '=', child.transaction_id)
      .executeTakeFirstOrThrow();
    expect(transaction.parent_transaction_id).toBe(parent.id);
  });

  it('releases reserved children before marking the parent failed', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 300,
      idempotency_key: 'parent-fail-recharge'
    });
    const parent = await createParentTransaction(db, userId);
    const firstChild = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'first-child',
      parent_transaction_id: parent.id,
      idempotency_key: 'first-child-reserve'
    });
    const secondChild = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'second-child',
      parent_transaction_id: parent.id,
      idempotency_key: 'second-child-reserve'
    });

    await failParentTransaction(db, {
      parent_transaction_id: parent.id,
      reason: 'parent failed'
    });

    const transactions = await db
      .selectFrom('point_transactions')
      .select(['id', 'status'])
      .where('id', 'in', [parent.id, firstChild.transaction_id, secondChild.transaction_id])
      .execute();
    expect(Object.fromEntries(transactions.map((row) => [row.id, row.status]))).toEqual({
      [parent.id]: 'FAILED',
      [firstChild.transaction_id]: 'RELEASED',
      [secondChild.transaction_id]: 'RELEASED'
    });

    const wallet = await db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(wallet.available_points).toBe(300);
    expect(wallet.held_points).toBe(0);
  });

  it('does not release children that are already captured', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 300,
      idempotency_key: 'captured-child-recharge'
    });
    const parent = await createParentTransaction(db, userId);
    const capturedChild = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'captured-child',
      parent_transaction_id: parent.id,
      idempotency_key: 'captured-child-reserve'
    });
    await captureReservation(db, {
      transaction_id: capturedChild.transaction_id
    });
    const reservedChild = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'reserved-child',
      parent_transaction_id: parent.id,
      idempotency_key: 'reserved-child-reserve'
    });

    await failParentTransaction(db, {
      parent_transaction_id: parent.id,
      reason: 'parent failed'
    });

    const transactions = await db
      .selectFrom('point_transactions')
      .select(['id', 'status'])
      .where('id', 'in', [capturedChild.transaction_id, reservedChild.transaction_id])
      .execute();
    expect(Object.fromEntries(transactions.map((row) => [row.id, row.status]))).toEqual({
      [capturedChild.transaction_id]: 'CAPTURED',
      [reservedChild.transaction_id]: 'RELEASED'
    });

    const wallet = await db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(wallet.available_points).toBe(200);
    expect(wallet.held_points).toBe(0);
  });

  it('handles repeated parent failure idempotently', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'repeat-parent-fail-recharge'
    });
    const parent = await createParentTransaction(db, userId);
    await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'repeat-child',
      parent_transaction_id: parent.id,
      idempotency_key: 'repeat-child-reserve'
    });

    await failParentTransaction(db, {
      parent_transaction_id: parent.id,
      reason: 'first failure'
    });
    await failParentTransaction(db, {
      parent_transaction_id: parent.id,
      reason: 'retry failure'
    });

    const parentAfterRetry = await db
      .selectFrom('point_transactions')
      .selectAll()
      .where('id', '=', parent.id)
      .executeTakeFirstOrThrow();
    expect(parentAfterRetry.status).toBe('FAILED');
    expect(await countReleaseEntries(db)).toBe(1);
  });
});
