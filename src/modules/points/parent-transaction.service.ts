import type { Json } from '../../db/generated.js';
import { withTransaction, type DbExecutor } from '../../db/transaction.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { releaseReservation } from './point.service.js';
import {
  findReservedChildTransactionsForUpdate,
  findTransactionForUpdate,
  updateTransactionStatus
} from './point-transaction.repository.js';

export interface FailParentTransactionInput {
  parent_transaction_id: string;
  reason: string;
}

export interface FailedParentTransactionResult {
  parent_transaction_id: string;
  status: 'FAILED';
  reason: string;
  released_child_transaction_ids: string[];
}

export async function failParentTransaction(
  db: DbExecutor,
  input: FailParentTransactionInput
): Promise<FailedParentTransactionResult> {
  return withTransaction(db, async (trx) => {
    const parent = await findTransactionForUpdate(trx, input.parent_transaction_id);
    if (!parent) {
      throw new NotFoundError('Parent transaction was not found', 'TRANSACTION_NOT_FOUND');
    }
    if (parent.status === 'FAILED') {
      return (parent.response_payload ?? {
        parent_transaction_id: parent.id,
        status: 'FAILED',
        reason: input.reason,
        released_child_transaction_ids: []
      }) as unknown as FailedParentTransactionResult;
    }
    if (parent.operation !== 'ACTION') {
      throw new ConflictError('Only action transactions can be failed', 'INVALID_TRANSACTION_STATE');
    }

    const reservedChildren = await findReservedChildTransactionsForUpdate(trx, parent.id);
    const releasedChildIds: string[] = [];

    for (const child of reservedChildren) {
      await releaseReservation(trx, {
        transaction_id: child.id
      });
      releasedChildIds.push(child.id);
    }

    const result: FailedParentTransactionResult = {
      parent_transaction_id: parent.id,
      status: 'FAILED',
      reason: input.reason,
      released_child_transaction_ids: releasedChildIds
    };

    await updateTransactionStatus(trx, {
      transactionId: parent.id,
      status: 'FAILED',
      responsePayload: result as unknown as Json
    });

    return result;
  });
}
