import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDb } from '../../src/db/database.js';
import { createMigrationDb, migrateToLatest } from '../../src/db/migrate.js';
import type { DbExecutor } from '../../src/db/transaction.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

async function resetTables(db: DbExecutor): Promise<void> {
  await sql`
    truncate table outbox_events, point_ledger_entries, point_transactions, wallets
    restart identity cascade
  `.execute(db);
}

describeWithDb('point management routes', () => {
  let db: ReturnType<typeof createDb>;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    const migrationDb = createMigrationDb(databaseUrl!);
    try {
      await migrateToLatest(migrationDb);
    } finally {
      await migrationDb.destroy();
    }

    db = createDb(databaseUrl!);
    app = await buildApp({
      db,
      loggerLevel: 'silent'
    });
  });

  beforeEach(async () => {
    await resetTables(db);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('serves health and swagger docs', async () => {
    const health = await app.inject({
      method: 'GET',
      url: '/health'
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const docs = await app.inject({
      method: 'GET',
      url: '/docs'
    });
    expect([200, 302]).toContain(docs.statusCode);
  });

  it('recharges a wallet and returns it by user id', async () => {
    const userId = randomUUID();

    const recharge = await app.inject({
      method: 'POST',
      url: '/wallets/recharge',
      payload: {
        user_id: userId,
        amount: 200,
        idempotency_key: 'route-recharge'
      }
    });
    expect(recharge.statusCode).toBe(200);
    expect(recharge.json()).toMatchObject({
      user_id: userId,
      amount: 200,
      available_points: 200,
      held_points: 0,
      status: 'RECHARGED'
    });

    const wallet = await app.inject({
      method: 'GET',
      url: `/wallets/${userId}`
    });
    expect(wallet.statusCode).toBe(200);
    expect(wallet.json()).toMatchObject({
      user_id: userId,
      available_points: 200,
      held_points: 0
    });
  });

  it('reserves, captures, and releases action points through routes', async () => {
    const captureUserId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/wallets/recharge',
      payload: {
        user_id: captureUserId,
        amount: 200,
        idempotency_key: 'route-capture-recharge'
      }
    });

    const reserveForCapture = await app.inject({
      method: 'POST',
      url: '/actions/reserve',
      payload: {
        user_id: captureUserId,
        action_id: 'route-capture-action',
        idempotency_key: 'route-capture-reserve'
      }
    });
    expect(reserveForCapture.statusCode).toBe(200);
    expect(reserveForCapture.json()).toMatchObject({
      user_id: captureUserId,
      action_id: 'route-capture-action',
      available_points: 100,
      held_points: 100,
      status: 'RESERVED'
    });

    const capture = await app.inject({
      method: 'POST',
      url: `/actions/${reserveForCapture.json().transaction_id}/capture`
    });
    expect(capture.statusCode).toBe(200);
    expect(capture.json()).toMatchObject({
      user_id: captureUserId,
      action_id: 'route-capture-action',
      available_points: 100,
      held_points: 0,
      status: 'CAPTURED'
    });

    const releaseUserId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/wallets/recharge',
      payload: {
        user_id: releaseUserId,
        amount: 200,
        idempotency_key: 'route-release-recharge'
      }
    });
    const reserveForRelease = await app.inject({
      method: 'POST',
      url: '/actions/reserve',
      payload: {
        user_id: releaseUserId,
        action_id: 'route-release-action',
        idempotency_key: 'route-release-reserve'
      }
    });

    const release = await app.inject({
      method: 'POST',
      url: `/actions/${reserveForRelease.json().transaction_id}/release`
    });
    expect(release.statusCode).toBe(200);
    expect(release.json()).toMatchObject({
      user_id: releaseUserId,
      action_id: 'route-release-action',
      available_points: 200,
      held_points: 0,
      status: 'RELEASED'
    });
  });
});
