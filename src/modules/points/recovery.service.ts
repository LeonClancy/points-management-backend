import { withTransaction, type DbExecutor } from '../../db/transaction.js';
import { releaseReservation } from './point.service.js';
import { findExpiredReservedTransactionsForUpdate } from './point-transaction.repository.js';

export interface ReleaseExpiredReservationsInput {
  now?: Date | string;
  limit?: number;
}

export interface ReleaseExpiredReservationsResult {
  released_transaction_ids: string[];
}

export async function releaseExpiredReservations(
  db: DbExecutor,
  input: ReleaseExpiredReservationsInput = {}
): Promise<ReleaseExpiredReservationsResult> {
  const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  const limit = input.limit ?? 100;

  return withTransaction(db, async (trx) => {
    const expiredReservations = await findExpiredReservedTransactionsForUpdate(
      trx,
      now,
      limit
    );
    const releasedTransactionIds: string[] = [];

    for (const reservation of expiredReservations) {
      await releaseReservation(trx, {
        transaction_id: reservation.id
      });
      releasedTransactionIds.push(reservation.id);
    }

    return {
      released_transaction_ids: releasedTransactionIds
    };
  });
}
