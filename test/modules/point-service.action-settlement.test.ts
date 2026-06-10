import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/database.js';
import { createMigrationDb, migrateToLatest } from '../../src/db/migrate.js';
import type { DbExecutor } from '../../src/db/transaction.js';
import {
  captureReservation,
  rechargePoints,
  releaseReservation,
  reserveActionPoints
} from '../../src/modules/points/point.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

async function resetTables(db: DbExecutor): Promise<void> {
  await sql`
    truncate table outbox_events, point_ledger_entries, point_transactions, wallets
    restart identity cascade
  `.execute(db);
}

async function countLedgerEntries(db: DbExecutor, entryType: string): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count
    from point_ledger_entries
    where entry_type = ${entryType}
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

async function countOutboxEvents(db: DbExecutor, eventType: string): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count
    from outbox_events
    where event_type = ${eventType}
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

describeWithDb('point service action settlement', () => {
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

  it('reserves 100 points when the wallet has enough available points', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'reserve-recharge'
    });

    const result = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'action-1',
      idempotency_key: 'reserve-1'
    });

    expect(result).toMatchObject({
      user_id: userId,
      action_id: 'action-1',
      amount: 100,
      available_points: 100,
      held_points: 100,
      status: 'RESERVED',
      parent_transaction_id: null
    });

    const wallet = await db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(wallet.available_points).toBe(100);
    expect(wallet.held_points).toBe(100);

    const transaction = await db
      .selectFrom('point_transactions')
      .selectAll()
      .where('id', '=', result.transaction_id)
      .executeTakeFirstOrThrow();
    expect(transaction.status).toBe('RESERVED');
    expect(transaction.operation).toBe('ACTION');
    expect(transaction.amount).toBe(100);
    expect(transaction.response_payload).toEqual(result);

    expect(await countLedgerEntries(db, 'RESERVE')).toBe(1);
    expect(await countOutboxEvents(db, 'points.reserved')).toBe(1);
  });

  it('rejects reserve when available points are insufficient', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 50,
      idempotency_key: 'small-recharge'
    });

    await expect(
      reserveActionPoints(db, {
        user_id: userId,
        action_id: 'too-expensive',
        idempotency_key: 'reserve-insufficient'
      })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_POINTS',
      statusCode: 409
    });

    const wallet = await db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(wallet.available_points).toBe(50);
    expect(wallet.held_points).toBe(0);
    expect(await countLedgerEntries(db, 'RESERVE')).toBe(0);
    expect(await countOutboxEvents(db, 'points.reserved')).toBe(0);
  });

  it('returns the existing reserve result for an idempotent reserve retry', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'retry-recharge'
    });
    const input = {
      user_id: userId,
      action_id: 'action-retry',
      idempotency_key: 'reserve-retry'
    };

    const first = await reserveActionPoints(db, input);
    const second = await reserveActionPoints(db, input);

    expect(second).toEqual(first);
    expect(await countLedgerEntries(db, 'RESERVE')).toBe(1);
    expect(await countOutboxEvents(db, 'points.reserved')).toBe(1);

    const wallet = await db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(wallet.available_points).toBe(100);
    expect(wallet.held_points).toBe(100);
  });

  it('rejects a reserve idempotency key reused with a different action payload', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 300,
      idempotency_key: 'conflict-recharge'
    });

    await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'first-action',
      idempotency_key: 'reserve-conflict'
    });

    await expect(
      reserveActionPoints(db, {
        user_id: userId,
        action_id: 'second-action',
        idempotency_key: 'reserve-conflict'
      })
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      statusCode: 409
    });
    expect(await countLedgerEntries(db, 'RESERVE')).toBe(1);
  });

  it('captures a reserved transaction once and moves held points out', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'capture-recharge'
    });
    const reserved = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'capture-action',
      idempotency_key: 'reserve-before-capture'
    });

    const captured = await captureReservation(db, {
      transaction_id: reserved.transaction_id
    });

    expect(captured).toMatchObject({
      transaction_id: reserved.transaction_id,
      user_id: userId,
      action_id: 'capture-action',
      amount: 100,
      available_points: 100,
      held_points: 0,
      status: 'CAPTURED'
    });
    expect(await countLedgerEntries(db, 'CAPTURE')).toBe(1);
    expect(await countOutboxEvents(db, 'points.captured')).toBe(1);
  });

  it('returns the existing capture result when capture is retried', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'capture-retry-recharge'
    });
    const reserved = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'capture-retry-action',
      idempotency_key: 'capture-retry-reserve'
    });

    const first = await captureReservation(db, {
      transaction_id: reserved.transaction_id
    });
    const second = await captureReservation(db, {
      transaction_id: reserved.transaction_id
    });

    expect(second).toEqual(first);
    expect(await countLedgerEntries(db, 'CAPTURE')).toBe(1);
    expect(await countOutboxEvents(db, 'points.captured')).toBe(1);
  });

  it('releases a reserved transaction once and refunds held points', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'release-recharge'
    });
    const reserved = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'release-action',
      idempotency_key: 'reserve-before-release'
    });

    const released = await releaseReservation(db, {
      transaction_id: reserved.transaction_id
    });

    expect(released).toMatchObject({
      transaction_id: reserved.transaction_id,
      user_id: userId,
      action_id: 'release-action',
      amount: 100,
      available_points: 200,
      held_points: 0,
      status: 'RELEASED'
    });
    expect(await countLedgerEntries(db, 'RELEASE')).toBe(1);
    expect(await countOutboxEvents(db, 'points.released')).toBe(1);
  });

  it('returns the existing release result when release is retried', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'release-retry-recharge'
    });
    const reserved = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'release-retry-action',
      idempotency_key: 'release-retry-reserve'
    });

    const first = await releaseReservation(db, {
      transaction_id: reserved.transaction_id
    });
    const second = await releaseReservation(db, {
      transaction_id: reserved.transaction_id
    });

    expect(second).toEqual(first);
    expect(await countLedgerEntries(db, 'RELEASE')).toBe(1);
    expect(await countOutboxEvents(db, 'points.released')).toBe(1);
  });

  it('rejects terminal transactions from transitioning again', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 300,
      idempotency_key: 'terminal-recharge'
    });
    const capturedReservation = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'captured-terminal',
      idempotency_key: 'captured-terminal-reserve'
    });
    await captureReservation(db, {
      transaction_id: capturedReservation.transaction_id
    });

    await expect(
      releaseReservation(db, {
        transaction_id: capturedReservation.transaction_id
      })
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION_STATE',
      statusCode: 409
    });

    const releasedReservation = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'released-terminal',
      idempotency_key: 'released-terminal-reserve'
    });
    await releaseReservation(db, {
      transaction_id: releasedReservation.transaction_id
    });

    await expect(
      captureReservation(db, {
        transaction_id: releasedReservation.transaction_id
      })
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION_STATE',
      statusCode: 409
    });
  });
});
