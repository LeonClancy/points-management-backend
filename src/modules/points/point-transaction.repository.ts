import { sql } from 'kysely';
import type {
  Json,
  PointOperation,
  PointTransactionStatus
} from '../../db/generated.js';
import type { DbExecutor } from '../../db/transaction.js';

export type TimestampInput = Date | string;

export interface CreatePointTransactionInput {
  walletId: string;
  parentTransactionId?: string | null;
  operation: PointOperation;
  status: PointTransactionStatus;
  amount: number;
  idempotencyScope: string;
  idempotencyKey: string;
  requestHash: string;
  responsePayload?: Json | null;
  expiresAt?: TimestampInput | null;
}

export interface UpdateTransactionStatusInput {
  transactionId: string;
  status: PointTransactionStatus;
  responsePayload?: Json | null;
  expiresAt?: TimestampInput | null;
}

export async function findByIdempotencyForUpdate(
  db: DbExecutor,
  scope: string,
  key: string
) {
  return db
    .selectFrom('point_transactions')
    .selectAll()
    .where('idempotency_scope', '=', scope)
    .where('idempotency_key', '=', key)
    .forUpdate()
    .executeTakeFirst();
}

export async function createPointTransaction(
  db: DbExecutor,
  input: CreatePointTransactionInput
) {
  return db
    .insertInto('point_transactions')
    .values({
      amount: input.amount,
      expires_at: input.expiresAt ?? null,
      idempotency_key: input.idempotencyKey,
      idempotency_scope: input.idempotencyScope,
      operation: input.operation,
      parent_transaction_id: input.parentTransactionId ?? null,
      request_hash: input.requestHash,
      response_payload: input.responsePayload ?? null,
      status: input.status,
      wallet_id: input.walletId
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function findTransactionForUpdate(db: DbExecutor, id: string) {
  return db
    .selectFrom('point_transactions')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
}

export async function updateTransactionStatus(
  db: DbExecutor,
  input: UpdateTransactionStatusInput
) {
  return db
    .updateTable('point_transactions')
    .set({
      ...(input.expiresAt !== undefined ? { expires_at: input.expiresAt } : {}),
      ...(input.responsePayload !== undefined
        ? { response_payload: input.responsePayload }
        : {}),
      status: input.status,
      updated_at: sql<Date>`now()`
    })
    .where('id', '=', input.transactionId)
    .returningAll()
    .executeTakeFirst();
}
