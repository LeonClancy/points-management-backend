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
import { reconcileWallet } from '../../src/modules/points/reconciliation.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

async function resetTables(db: DbExecutor): Promise<void> {
  await sql`
    truncate table outbox_events, point_ledger_entries, point_transactions, wallets
    restart identity cascade
  `.execute(db);
}

describeWithDb('wallet reconciliation', () => {
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

  it('reports a wallet as consistent when projection matches ledger deltas', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'reconcile-recharge'
    });
    const reserved = await reserveActionPoints(db, {
      user_id: userId,
      action_id: 'reconcile-action',
      idempotency_key: 'reconcile-reserve'
    });
    await captureReservation(db, {
      transaction_id: reserved.transaction_id
    });

    await expect(reconcileWallet(db, userId)).resolves.toEqual({
      consistent: true,
      wallet_available_points: 100,
      wallet_held_points: 0,
      ledger_available_points: 100,
      ledger_held_points: 0
    });
  });

  it('reports projection drift when wallet balances differ from ledger deltas', async () => {
    const userId = randomUUID();
    await rechargePoints(db, {
      user_id: userId,
      amount: 200,
      idempotency_key: 'drift-recharge'
    });
    await db
      .updateTable('wallets')
      .set({ available_points: 201 })
      .where('user_id', '=', userId)
      .execute();

    await expect(reconcileWallet(db, userId)).resolves.toEqual({
      consistent: false,
      wallet_available_points: 201,
      wallet_held_points: 0,
      ledger_available_points: 200,
      ledger_held_points: 0
    });
  });
});
