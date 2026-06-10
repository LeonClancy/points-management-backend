import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/database.js';
import { createMigrationDb, migrateToLatest } from '../../src/db/migrate.js';
import { withTransaction } from '../../src/db/transaction.js';
import type { DB, Json } from '../../src/db/generated.js';
import type { DbExecutor } from '../../src/db/transaction.js';
import {
  createWallet,
  findWalletByUserIdForUpdate,
  updateWalletBalances
} from '../../src/modules/wallets/wallet.repository.js';
import {
  createPointTransaction,
  findByIdempotencyForUpdate,
  findTransactionForUpdate,
  updateTransactionStatus
} from '../../src/modules/points/point-transaction.repository.js';
import { appendLedgerEntry } from '../../src/modules/points/ledger.repository.js';
import * as ledgerRepository from '../../src/modules/points/ledger.repository.js';
import { appendOutboxEvent } from '../../src/modules/outbox/outbox.repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

async function resetTables(db: DbExecutor): Promise<void> {
  await sql`
    truncate table outbox_events, point_ledger_entries, point_transactions, wallets
    restart identity cascade
  `.execute(db);
}

describeWithDb('point accounting repositories', () => {
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

  it('creates a wallet by user id with zero balances', async () => {
    const userId = randomUUID();

    const wallet = await createWallet(db, userId);

    expect(wallet.user_id).toBe(userId);
    expect(wallet.available_points).toBe(0);
    expect(wallet.held_points).toBe(0);
    expect(wallet.version).toBe(1);
  });

  it('locks wallet rows when selecting by user id for update', async () => {
    const userId = randomUUID();
    await createWallet(db, userId);

    await withTransaction(db, async (holdingTrx) => {
      const lockedWallet = await findWalletByUserIdForUpdate(holdingTrx, userId);
      expect(lockedWallet?.user_id).toBe(userId);

      const competingDb = createDb(databaseUrl!);
      try {
        await expect(
          withTransaction(competingDb, async (competingTrx) => {
            await sql`set local lock_timeout = '100ms'`.execute(competingTrx);
            await findWalletByUserIdForUpdate(competingTrx, userId);
          })
        ).rejects.toThrow(/lock timeout|canceling statement/i);
      } finally {
        await competingDb.destroy();
      }
    });
  });

  it('updates wallet balances using database-side arithmetic and constraints', async () => {
    const wallet = await createWallet(db, randomUUID());

    const recharged = await updateWalletBalances(db, {
      walletId: wallet.id,
      availableDelta: 150,
      heldDelta: 0
    });
    expect(recharged?.available_points).toBe(150);
    expect(recharged?.held_points).toBe(0);
    expect(recharged?.version).toBe(2);

    const reserved = await updateWalletBalances(db, {
      walletId: wallet.id,
      availableDelta: -100,
      heldDelta: 100
    });
    expect(reserved?.available_points).toBe(50);
    expect(reserved?.held_points).toBe(100);
    expect(reserved?.version).toBe(3);

    await expect(
      updateWalletBalances(db, {
        walletId: wallet.id,
        availableDelta: -999,
        heldDelta: 0
      })
    ).rejects.toThrow();
  });

  it('creates and finds point transactions by idempotency key with row locks', async () => {
    const wallet = await createWallet(db, randomUUID());

    const transaction = await createPointTransaction(db, {
      walletId: wallet.id,
      operation: 'RECHARGE',
      status: 'RECHARGED',
      amount: 200,
      idempotencyScope: 'recharge',
      idempotencyKey: 'request-1',
      requestHash: 'hash-1',
      responsePayload: { walletId: wallet.id, amount: 200 }
    });

    const byIdempotency = await withTransaction(db, (trx) =>
      findByIdempotencyForUpdate(trx, 'recharge', 'request-1')
    );
    expect(byIdempotency?.id).toBe(transaction.id);

    const byId = await withTransaction(db, (trx) =>
      findTransactionForUpdate(trx, transaction.id)
    );
    expect(byId?.idempotency_key).toBe('request-1');
  });

  it('updates point transaction status and response payload', async () => {
    const wallet = await createWallet(db, randomUUID());
    const transaction = await createPointTransaction(db, {
      walletId: wallet.id,
      operation: 'ACTION',
      status: 'RESERVED',
      amount: 100,
      idempotencyScope: 'action',
      idempotencyKey: 'request-2',
      requestHash: 'hash-2',
      responsePayload: null,
      expiresAt: new Date(Date.now() + 60_000)
    });

    const payload = { transactionId: transaction.id, status: 'captured' } satisfies Json;
    const updated = await updateTransactionStatus(db, {
      transactionId: transaction.id,
      status: 'CAPTURED',
      responsePayload: payload
    });

    expect(updated?.status).toBe('CAPTURED');
    expect(updated?.response_payload).toEqual(payload);
  });

  it('appends ledger entries without exposing mutation helpers', async () => {
    const wallet = await createWallet(db, randomUUID());
    const transaction = await createPointTransaction(db, {
      walletId: wallet.id,
      operation: 'RECHARGE',
      status: 'RECHARGED',
      amount: 100,
      idempotencyScope: 'recharge',
      idempotencyKey: 'request-3',
      requestHash: 'hash-3',
      responsePayload: null
    });

    const ledgerEntry = await appendLedgerEntry(db, {
      walletId: wallet.id,
      transactionId: transaction.id,
      entryType: 'RECHARGE',
      availableDelta: 100,
      heldDelta: 0
    });

    expect(ledgerEntry.wallet_id).toBe(wallet.id);
    expect(ledgerEntry.available_delta).toBe(100);
    expect(ledgerEntry.held_delta).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(ledgerRepository, 'updateLedgerEntry')).toBe(
      false
    );
    expect(Object.prototype.hasOwnProperty.call(ledgerRepository, 'deleteLedgerEntry')).toBe(
      false
    );
  });

  it('appends outbox events as pending with zero attempts', async () => {
    const aggregateId = randomUUID();
    const payload = { aggregateId, reason: 'repository-test' } satisfies Json;

    const event = await appendOutboxEvent(db, {
      aggregateType: 'point_transaction',
      aggregateId,
      eventType: 'points.recharged',
      payload
    });

    expect(event.aggregate_id).toBe(aggregateId);
    expect(event.payload).toEqual(payload);
    expect(event.status).toBe('PENDING');
    expect(event.attempts).toBe(0);
  });
});
