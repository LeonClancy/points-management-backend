import type { LedgerEntryType } from '../../db/generated.js';
import type { DbExecutor } from '../../db/transaction.js';

export interface AppendLedgerEntryInput {
  walletId: string;
  transactionId: string;
  entryType: LedgerEntryType;
  availableDelta: number;
  heldDelta: number;
}

export async function appendLedgerEntry(db: DbExecutor, input: AppendLedgerEntryInput) {
  return db
    .insertInto('point_ledger_entries')
    .values({
      available_delta: input.availableDelta,
      entry_type: input.entryType,
      held_delta: input.heldDelta,
      transaction_id: input.transactionId,
      wallet_id: input.walletId
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
