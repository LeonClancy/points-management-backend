import type { Json } from '../../db/generated.js';
import { withTransaction, type DbExecutor } from '../../db/transaction.js';
import { ConflictError, NotFoundError, ValidationAppError } from '../../shared/errors.js';
import { appendOutboxEvent } from '../outbox/outbox.repository.js';
import {
  createWallet,
  findWalletByIdForUpdate,
  findWalletByUserIdForUpdate,
  updateWalletBalances
} from '../wallets/wallet.repository.js';
import { assertSameRequestHash, hashPayload } from './idempotency.js';
import { appendLedgerEntry } from './ledger.repository.js';
import {
  createPointTransaction,
  findByIdempotencyForUpdate,
  findTransactionForUpdate,
  updateTransactionStatus
} from './point-transaction.repository.js';

export const ACTION_POINT_COST = 100;
const RESERVATION_TTL_MS = 15 * 60 * 1000;

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

export interface ReserveActionPointsInput {
  user_id: string;
  action_id: string;
  idempotency_key: string;
  parent_transaction_id?: string | null;
  expires_at?: Date | string | null;
}

export interface CaptureReservationInput {
  transaction_id: string;
}

export interface ReleaseReservationInput {
  transaction_id: string;
}

export type ActionSettlementStatus = 'RESERVED' | 'CAPTURED' | 'RELEASED';

export interface ActionSettlementResult {
  transaction_id: string;
  wallet_id: string;
  user_id: string;
  action_id: string;
  parent_transaction_id: string | null;
  amount: number;
  available_points: number;
  held_points: number;
  status: ActionSettlementStatus;
  expires_at: string | null;
}

function buildRechargeIdempotencyScope(userId: string): string {
  return `points.recharge:${userId}`;
}

function buildReserveIdempotencyScope(userId: string): string {
  return `points.reserve:${userId}`;
}

function buildRechargeRequestHash(input: RechargePointsInput): string {
  return hashPayload({
    amount: input.amount,
    operation: 'RECHARGE',
    user_id: input.user_id
  });
}

function buildReserveRequestHash(input: ReserveActionPointsInput): string {
  return hashPayload({
    action_id: input.action_id,
    amount: ACTION_POINT_COST,
    operation: 'ACTION_RESERVE',
    parent_transaction_id: input.parent_transaction_id ?? null,
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

function validateReserveInput(input: ReserveActionPointsInput): void {
  if (input.action_id.trim() === '') {
    throw new ValidationAppError('Action id is required', 'INVALID_ACTION_ID');
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

function responsePayloadToActionResult(payload: Json | null): ActionSettlementResult {
  if (payload === null) {
    throw new ConflictError(
      'Existing action response is not available',
      'IDEMPOTENCY_RESPONSE_MISSING'
    );
  }

  return payload as unknown as ActionSettlementResult;
}

function jsonPayload<T extends Json>(payload: T): Json {
  return payload;
}

function normalizeExpiresAt(expiresAt: Date | string | null | undefined): {
  dbValue: Date | string;
  responseValue: string;
} {
  const value = expiresAt ?? new Date(Date.now() + RESERVATION_TTL_MS);
  const responseValue = value instanceof Date ? value.toISOString() : new Date(value).toISOString();

  return {
    dbValue: value,
    responseValue
  };
}

function invalidTransition(message: string): ConflictError {
  return new ConflictError(message, 'INVALID_TRANSACTION_STATE');
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

export async function reserveActionPoints(
  db: DbExecutor,
  input: ReserveActionPointsInput
): Promise<ActionSettlementResult> {
  validateReserveInput(input);

  const idempotencyScope = buildReserveIdempotencyScope(input.user_id);
  const requestHash = buildReserveRequestHash(input);
  const expiresAt = normalizeExpiresAt(input.expires_at);

  return withTransaction(db, async (trx) => {
    const existing = await findByIdempotencyForUpdate(
      trx,
      idempotencyScope,
      input.idempotency_key
    );
    if (existing) {
      assertSameRequestHash(existing.request_hash, requestHash);
      return responsePayloadToActionResult(existing.response_payload);
    }

    let wallet = await findWalletByUserIdForUpdate(trx, input.user_id);
    if (!wallet) {
      await createWallet(trx, input.user_id);
      wallet = await findWalletByUserIdForUpdate(trx, input.user_id);
    }
    if (!wallet) {
      throw new Error('Failed to create wallet');
    }
    if (wallet.available_points < ACTION_POINT_COST) {
      throw new ConflictError('Insufficient available points', 'INSUFFICIENT_POINTS');
    }

    const transaction = await createPointTransaction(trx, {
      walletId: wallet.id,
      parentTransactionId: input.parent_transaction_id ?? null,
      operation: 'ACTION',
      status: 'RESERVED',
      amount: ACTION_POINT_COST,
      idempotencyScope,
      idempotencyKey: input.idempotency_key,
      requestHash,
      responsePayload: null,
      expiresAt: expiresAt.dbValue
    });

    const updatedWallet = await updateWalletBalances(trx, {
      walletId: wallet.id,
      availableDelta: -ACTION_POINT_COST,
      heldDelta: ACTION_POINT_COST
    });
    if (!updatedWallet) {
      throw new Error('Failed to update wallet');
    }

    await appendLedgerEntry(trx, {
      walletId: wallet.id,
      transactionId: transaction.id,
      entryType: 'RESERVE',
      availableDelta: -ACTION_POINT_COST,
      heldDelta: ACTION_POINT_COST
    });

    const result: ActionSettlementResult = {
      transaction_id: transaction.id,
      wallet_id: wallet.id,
      user_id: input.user_id,
      action_id: input.action_id,
      parent_transaction_id: input.parent_transaction_id ?? null,
      amount: ACTION_POINT_COST,
      available_points: updatedWallet.available_points,
      held_points: updatedWallet.held_points,
      status: 'RESERVED',
      expires_at: expiresAt.responseValue
    };
    const responsePayload = jsonPayload(result as unknown as Json);

    await appendOutboxEvent(trx, {
      aggregateType: 'point_transaction',
      aggregateId: transaction.id,
      eventType: 'points.reserved',
      payload: responsePayload
    });

    await updateTransactionStatus(trx, {
      transactionId: transaction.id,
      status: 'RESERVED',
      responsePayload
    });

    return result;
  });
}

export async function captureReservation(
  db: DbExecutor,
  input: CaptureReservationInput
): Promise<ActionSettlementResult> {
  return settleReservation(db, {
    transactionId: input.transaction_id,
    terminalStatus: 'CAPTURED',
    ledgerEntryType: 'CAPTURE',
    availableDelta: 0,
    heldDelta: -ACTION_POINT_COST,
    eventType: 'points.captured',
    terminalConflictStatuses: ['RELEASED', 'FAILED', 'RECHARGED']
  });
}

export async function releaseReservation(
  db: DbExecutor,
  input: ReleaseReservationInput
): Promise<ActionSettlementResult> {
  return settleReservation(db, {
    transactionId: input.transaction_id,
    terminalStatus: 'RELEASED',
    ledgerEntryType: 'RELEASE',
    availableDelta: ACTION_POINT_COST,
    heldDelta: -ACTION_POINT_COST,
    eventType: 'points.released',
    terminalConflictStatuses: ['CAPTURED', 'FAILED', 'RECHARGED']
  });
}

interface SettleReservationInput {
  transactionId: string;
  terminalStatus: 'CAPTURED' | 'RELEASED';
  ledgerEntryType: 'CAPTURE' | 'RELEASE';
  availableDelta: number;
  heldDelta: number;
  eventType: 'points.captured' | 'points.released';
  terminalConflictStatuses: string[];
}

async function settleReservation(
  db: DbExecutor,
  input: SettleReservationInput
): Promise<ActionSettlementResult> {
  return withTransaction(db, async (trx) => {
    const transaction = await findTransactionForUpdate(trx, input.transactionId);
    if (!transaction) {
      throw new NotFoundError('Point transaction was not found', 'TRANSACTION_NOT_FOUND');
    }

    if (transaction.operation !== 'ACTION') {
      throw invalidTransition('Only action transactions can be settled');
    }

    if (transaction.status === input.terminalStatus) {
      return responsePayloadToActionResult(transaction.response_payload);
    }
    if (transaction.status !== 'RESERVED') {
      throw invalidTransition(
        `Cannot transition transaction from ${transaction.status} to ${input.terminalStatus}`
      );
    }
    if (input.terminalConflictStatuses.includes(transaction.status)) {
      throw invalidTransition(
        `Cannot transition transaction from ${transaction.status} to ${input.terminalStatus}`
      );
    }

    const reservedResult = responsePayloadToActionResult(transaction.response_payload);
    const wallet = await findWalletByIdForUpdate(trx, transaction.wallet_id);
    if (!wallet) {
      throw new NotFoundError('Wallet was not found', 'WALLET_NOT_FOUND');
    }

    const updatedWallet = await updateWalletBalances(trx, {
      walletId: wallet.id,
      availableDelta: input.availableDelta,
      heldDelta: input.heldDelta
    });
    if (!updatedWallet) {
      throw new Error('Failed to update wallet');
    }

    await appendLedgerEntry(trx, {
      walletId: wallet.id,
      transactionId: transaction.id,
      entryType: input.ledgerEntryType,
      availableDelta: input.availableDelta,
      heldDelta: input.heldDelta
    });

    const result: ActionSettlementResult = {
      transaction_id: transaction.id,
      wallet_id: wallet.id,
      user_id: wallet.user_id,
      action_id: reservedResult.action_id,
      parent_transaction_id: reservedResult.parent_transaction_id,
      amount: ACTION_POINT_COST,
      available_points: updatedWallet.available_points,
      held_points: updatedWallet.held_points,
      status: input.terminalStatus,
      expires_at: reservedResult.expires_at
    };
    const responsePayload = jsonPayload(result as unknown as Json);

    await appendOutboxEvent(trx, {
      aggregateType: 'point_transaction',
      aggregateId: transaction.id,
      eventType: input.eventType,
      payload: responsePayload
    });

    await updateTransactionStatus(trx, {
      transactionId: transaction.id,
      status: input.terminalStatus,
      responsePayload
    });

    return result;
  });
}
