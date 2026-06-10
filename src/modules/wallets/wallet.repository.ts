import { sql } from 'kysely';
import type { DbExecutor } from '../../db/transaction.js';

export interface UpdateWalletBalancesInput {
  walletId: string;
  availableDelta: number;
  heldDelta: number;
}

export async function findWalletByUserIdForUpdate(db: DbExecutor, userId: string) {
  return db
    .selectFrom('wallets')
    .selectAll()
    .where('user_id', '=', userId)
    .forUpdate()
    .executeTakeFirst();
}

export async function findWalletByUserId(db: DbExecutor, userId: string) {
  return db
    .selectFrom('wallets')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

export async function findWalletByIdForUpdate(db: DbExecutor, walletId: string) {
  return db
    .selectFrom('wallets')
    .selectAll()
    .where('id', '=', walletId)
    .forUpdate()
    .executeTakeFirst();
}

export async function createWallet(db: DbExecutor, userId: string) {
  return db
    .insertInto('wallets')
    .values({
      user_id: userId
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function updateWalletBalances(
  db: DbExecutor,
  input: UpdateWalletBalancesInput
) {
  return db
    .updateTable('wallets')
    .set((eb) => ({
      available_points: sql<number>`${eb.ref('available_points')} + ${input.availableDelta}`,
      held_points: sql<number>`${eb.ref('held_points')} + ${input.heldDelta}`,
      updated_at: sql<Date>`now()`,
      version: sql<number>`${eb.ref('version')} + 1`
    }))
    .where('id', '=', input.walletId)
    .returningAll()
    .executeTakeFirst();
}
