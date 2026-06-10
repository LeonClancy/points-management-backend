import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/database.js';
import { createMigrationDb, migrateToLatest } from '../../src/db/migrate.js';
import type { DbExecutor } from '../../src/db/transaction.js';
import { rechargePoints } from '../../src/modules/points/point.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

async function resetTables(db: DbExecutor): Promise<void> {
  await sql`
    truncate table outbox_events, point_ledger_entries, point_transactions, wallets
    restart identity cascade
  `.execute(db);
}

async function countWallets(db: DbExecutor): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count from wallets
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

async function countTransactions(db: DbExecutor): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count from point_transactions
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

async function countLedgerEntries(db: DbExecutor): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count from point_ledger_entries
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

async function countOutboxEvents(db: DbExecutor): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count from outbox_events
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

describeWithDb('point service recharge', () => {
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

  it('creates a wallet for the first recharge and increases available points', async () => {
    const userId = randomUUID();

    const result = await rechargePoints(db, {
      user_id: userId,
      amount: 250,
      idempotency_key: 'recharge-1'
    });

    expect(result).toMatchObject({
      user_id: userId,
      amount: 250,
      available_points: 250,
      held_points: 0,
      status: 'RECHARGED'
    });
    expect(result.transaction_id).toEqual(expect.any(String));
    expect(result.wallet_id).toEqual(expect.any(String));

    const wallet = await db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();

    expect(wallet.id).toBe(result.wallet_id);
    expect(wallet.available_points).toBe(250);
    expect(wallet.held_points).toBe(0);

    const transaction = await db
      .selectFrom('point_transactions')
      .selectAll()
      .where('id', '=', result.transaction_id)
      .executeTakeFirstOrThrow();

    expect(transaction.operation).toBe('RECHARGE');
    expect(transaction.status).toBe('RECHARGED');
    expect(transaction.amount).toBe(250);
    expect(transaction.response_payload).toEqual(result);
  });

  it('returns the existing recharge result for an idempotent retry', async () => {
    const userId = randomUUID();
    const input = {
      user_id: userId,
      amount: 250,
      idempotency_key: 'retry-key'
    };

    const first = await rechargePoints(db, input);
    const second = await rechargePoints(db, input);

    expect(second).toEqual(first);
    expect(await countWallets(db)).toBe(1);
    expect(await countTransactions(db)).toBe(1);
    expect(await countLedgerEntries(db)).toBe(1);
    expect(await countOutboxEvents(db)).toBe(1);

    const wallet = await db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();

    expect(wallet.available_points).toBe(250);
    expect(wallet.held_points).toBe(0);
  });

  it('rejects the same idempotency key with a different recharge payload', async () => {
    const userId = randomUUID();

    await rechargePoints(db, {
      user_id: userId,
      amount: 100,
      idempotency_key: 'conflict-key'
    });

    await expect(
      rechargePoints(db, {
        user_id: userId,
        amount: 200,
        idempotency_key: 'conflict-key'
      })
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      statusCode: 409
    });

    expect(await countTransactions(db)).toBe(1);
    expect(await countLedgerEntries(db)).toBe(1);
    expect(await countOutboxEvents(db)).toBe(1);

    const wallet = await db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();

    expect(wallet.available_points).toBe(100);
  });

  it('appends exactly one recharge ledger entry', async () => {
    const result = await rechargePoints(db, {
      user_id: randomUUID(),
      amount: 75,
      idempotency_key: 'ledger-key'
    });

    const ledgerEntries = await db
      .selectFrom('point_ledger_entries')
      .selectAll()
      .execute();

    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]).toMatchObject({
      wallet_id: result.wallet_id,
      transaction_id: result.transaction_id,
      entry_type: 'RECHARGE',
      available_delta: 75,
      held_delta: 0
    });
  });

  it('appends exactly one recharge outbox event', async () => {
    const result = await rechargePoints(db, {
      user_id: randomUUID(),
      amount: 125,
      idempotency_key: 'outbox-key'
    });

    const events = await db.selectFrom('outbox_events').selectAll().execute();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregate_type: 'point_transaction',
      aggregate_id: result.transaction_id,
      event_type: 'points.recharged',
      status: 'PENDING',
      attempts: 0
    });
    expect(events[0]?.payload).toEqual(result);
  });

  it('rejects non-positive recharge amounts', async () => {
    await expect(
      rechargePoints(db, {
        user_id: randomUUID(),
        amount: 0,
        idempotency_key: 'invalid-amount'
      })
    ).rejects.toMatchObject({
      code: 'INVALID_RECHARGE_AMOUNT',
      statusCode: 400
    });

    expect(await countWallets(db)).toBe(0);
    expect(await countTransactions(db)).toBe(0);
  });
});
