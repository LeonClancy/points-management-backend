import type { Json } from '../../db/generated.js';
import { withTransaction, type DbExecutor } from '../../db/transaction.js';
import { ValidationAppError, ConflictError } from '../../shared/errors.js';
import { appendOutboxEvent } from '../outbox/outbox.repository.js';
import {
  createWallet,
  findWalletByUserIdForUpdate,
  updateWalletBalances
} from '../wallets/wallet.repository.js';
import { assertSameRequestHash, hashPayload } from './idempotency.js';
import { appendLedgerEntry } from './ledger.repository.js';
import {
  createPointTransaction,
  findByIdempotencyForUpdate,
  updateTransactionStatus
} from './point-transaction.repository.js';

export interface RechargePointsInput {
  user_id: string;
  amount: number;
  idempotency_key: string;
}

export interface RechargeResult {
  transaction_id: string;
  wallet_id: string;
  user_id: string;
  amount: number;
  available_points: number;
  held_points: number;
  status: 'RECHARGED';
}

function buildRechargeIdempotencyScope(userId: string): string {
  return `points.recharge:${userId}`;
}

function buildRechargeRequestHash(input: RechargePointsInput): string {
  return hashPayload({
    amount: input.amount,
    operation: 'RECHARGE',
    user_id: input.user_id
  });
}

function validateRechargeInput(input: RechargePointsInput): void {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new ValidationAppError(
      'Recharge amount must be a positive integer',
      'INVALID_RECHARGE_AMOUNT'
    );
  }
}

function responsePayloadToRechargeResult(payload: Json | null): RechargeResult {
  if (payload === null) {
    throw new ConflictError(
      'Existing idempotency response is not available',
      'IDEMPOTENCY_RESPONSE_MISSING'
    );
  }

  return payload as unknown as RechargeResult;
}

export async function rechargePoints(
  db: DbExecutor,
  input: RechargePointsInput
): Promise<RechargeResult> {
  validateRechargeInput(input);

  const idempotencyScope = buildRechargeIdempotencyScope(input.user_id);
  const requestHash = buildRechargeRequestHash(input);

  return withTransaction(db, async (trx) => {
    const existing = await findByIdempotencyForUpdate(
      trx,
      idempotencyScope,
      input.idempotency_key
    );
    if (existing) {
      assertSameRequestHash(existing.request_hash, requestHash);
      return responsePayloadToRechargeResult(existing.response_payload);
    }

    let wallet = await findWalletByUserIdForUpdate(trx, input.user_id);
    if (!wallet) {
      await createWallet(trx, input.user_id);
      wallet = await findWalletByUserIdForUpdate(trx, input.user_id);
    }
    if (!wallet) {
      throw new Error('Failed to create wallet');
    }

    const transaction = await createPointTransaction(trx, {
      walletId: wallet.id,
      operation: 'RECHARGE',
      status: 'RECHARGED',
      amount: input.amount,
      idempotencyScope,
      idempotencyKey: input.idempotency_key,
      requestHash,
      responsePayload: null
    });

    const updatedWallet = await updateWalletBalances(trx, {
      walletId: wallet.id,
      availableDelta: input.amount,
      heldDelta: 0
    });
    if (!updatedWallet) {
      throw new Error('Failed to update wallet');
    }

    await appendLedgerEntry(trx, {
      walletId: wallet.id,
      transactionId: transaction.id,
      entryType: 'RECHARGE',
      availableDelta: input.amount,
      heldDelta: 0
    });

    const result: RechargeResult = {
      transaction_id: transaction.id,
      wallet_id: wallet.id,
      user_id: input.user_id,
      amount: input.amount,
      available_points: updatedWallet.available_points,
      held_points: updatedWallet.held_points,
      status: 'RECHARGED'
    };
    const responsePayload = result as unknown as Json;

    await appendOutboxEvent(trx, {
      aggregateType: 'point_transaction',
      aggregateId: transaction.id,
      eventType: 'points.recharged',
      payload: responsePayload
    });

    await updateTransactionStatus(trx, {
      transactionId: transaction.id,
      status: 'RECHARGED',
      responsePayload
    });

    return result;
  });
}
