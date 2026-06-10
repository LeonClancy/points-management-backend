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
import { releaseExpiredReservations } from '../../src/modules/points/recovery.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

async function resetTables(db: DbExecutor): Promise<void> {
  await sql`
    truncate table outbox_events, point_ledger_entries, point_transactions, wallets
    restart identity cascade
  `.execute(db);
}

async function countReleaseEntries(db: DbExecutor): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count
    from point_ledger_entries
    where entry_type = 'RELEASE'
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

describeWithDb('reservation recovery', () => {
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

  it('releases expired reserved transactions', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'expired-recharge'
    });
    const expired = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'expired-action',
      expires_at: '2026-06-10T00:00:00.000Z',
      idempotency_key: 'expired-reserve'
    });

    const result = await releaseExpiredReservations(db, {
      now: '2026-06-10T01:00:00.000Z'
    });

    expect(result.released_transaction_ids).toEqual([expired.transaction_id]);
    const transaction = await db
      .selectFrom('point_transactions')
      .selectAll()
      .where('id', '=', expired.transaction_id)
      .executeTakeFirstOrThrow();
    expect(transaction.status).toBe('RELEASED');

    const wallet = await db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(wallet.available_points).toBe(200);
    expect(wallet.held_points).toBe(0);
  });

  it('ignores already captured reservations', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'captured-expired-recharge'
    });
    const reserved = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'captured-expired-action',
      expires_at: '2026-06-10T00:00:00.000Z',
      idempotency_key: 'captured-expired-reserve'
    });
    await captureReservation(db, {
      transaction_id: reserved.transaction_id
    });

    const result = await releaseExpiredReservations(db, {
      now: '2026-06-10T01:00:00.000Z'
    });

    expect(result.released_transaction_ids).toEqual([]);
    expect(await countReleaseEntries(db)).toBe(0);
  });

  it('ignores already released reservations', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'released-expired-recharge'
    });
    const reserved = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'released-expired-action',
      expires_at: '2026-06-10T00:00:00.000Z',
      idempotency_key: 'released-expired-reserve'
    });
    await releaseReservation(db, {
      transaction_id: reserved.transaction_id
    });

    const result = await releaseExpiredReservations(db, {
      now: '2026-06-10T01:00:00.000Z'
    });

    expect(result.released_transaction_ids).toEqual([]);
    expect(await countReleaseEntries(db)).toBe(1);
  });
});
