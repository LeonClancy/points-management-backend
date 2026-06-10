import { sql } from 'kysely';
import type { DbExecutor } from '../../db/transaction.js';
import { NotFoundError } from '../../shared/errors.js';

export interface ReconcileWalletResult {
  consistent: boolean;
  wallet_available_points: number;
  wallet_held_points: number;
  ledger_available_points: number;
  ledger_held_points: number;
}

export async function reconcileWallet(
  db: DbExecutor,
  userId: string
): Promise<ReconcileWalletResult> {
  const wallet = await db
    .selectFrom('wallets')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!wallet) {
    throw new NotFoundError('Wallet was not found', 'WALLET_NOT_FOUND');
  }

  const ledger = await db
    .selectFrom('point_ledger_entries')
    .select([
      sql<number>`coalesce(sum(available_delta), 0)::int`.as('available_points'),
      sql<number>`coalesce(sum(held_delta), 0)::int`.as('held_points')
    ])
    .where('wallet_id', '=', wallet.id)
    .executeTakeFirstOrThrow();

  const ledgerAvailablePoints = ledger.available_points ?? 0;
  const ledgerHeldPoints = ledger.held_points ?? 0;

  return {
    consistent:
      wallet.available_points === ledgerAvailablePoints &&
      wallet.held_points === ledgerHeldPoints,
    wallet_available_points: wallet.available_points,
    wallet_held_points: wallet.held_points,
    ledger_available_points: ledgerAvailablePoints,
    ledger_held_points: ledgerHeldPoints
  };
}
