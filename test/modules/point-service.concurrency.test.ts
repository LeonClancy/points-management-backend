import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/database.js';
import { createMigrationDb, migrateToLatest } from '../../src/db/migrate.js';
import { withTransaction, type DbExecutor } from '../../src/db/transaction.js';
import {
  rechargePoints,
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

async function countActionTransactions(db: DbExecutor): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count
    from point_transactions
    where operation = 'ACTION'
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

async function countActionLedgerEntries(db: DbExecutor): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count
    from point_ledger_entries
    where entry_type in ('RESERVE', 'CAPTURE', 'RELEASE')
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

async function countActionOutboxEvents(db: DbExecutor): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count
    from outbox_events
    where event_type in ('points.reserved', 'points.captured', 'points.released')
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

describeWithDb('point service concurrency and atomicity', () => {
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

  it('serializes two concurrent reserves so only one can spend the same 100 points', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 100,
      idempotency_key: 'concurrent-recharge'
    });

    const competingDb = createDb(databaseUrl!);
    try {
      const results = await Promise.allSettled([
        reserveActionPoints(db, {
          user_id: userId,
          action_id: 'concurrent-action-1',
          idempotency_key: 'concurrent-reserve-1'
        }),
        reserveActionPoints(competingDb, {
          user_id: userId,
          action_id: 'concurrent-action-2',
          idempotency_key: 'concurrent-reserve-2'
        })
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: {
          code: 'INSUFFICIENT_POINTS',
          statusCode: 409
        }
      });

      const wallet = await db
        .selectFrom('wallets')
        .selectAll()
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
      expect(wallet.available_points).toBe(0);
      expect(wallet.held_points).toBe(100);
      expect(await countActionTransactions(db)).toBe(1);
      expect(await countActionLedgerEntries(db)).toBe(1);
      expect(await countActionOutboxEvents(db)).toBe(1);
    } finally {
      await competingDb.destroy();
    }
  });

  it('rolls back wallet, transaction, ledger, and outbox writes when the operation rolls back', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 100,
      idempotency_key: 'rollback-recharge'
    });

    await expect(
      withTransaction(db, async (trx) => {
        await reserveActionPoints(trx, {
          user_id: userId,
          action_id: 'rolled-back-action',
          idempotency_key: 'rolled-back-reserve'
        });
        throw new Error('force outer rollback');
      })
    ).rejects.toThrow('force outer rollback');

    const wallet = await db
      .selectFrom('wallets')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(wallet.available_points).toBe(100);
    expect(wallet.held_points).toBe(0);
    expect(await countActionTransactions(db)).toBe(0);
    expect(await countActionLedgerEntries(db)).toBe(0);
    expect(await countActionOutboxEvents(db)).toBe(0);
  });
});
