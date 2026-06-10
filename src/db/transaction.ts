import { Kysely, sql, type Transaction } from 'kysely';
import type { DB } from './generated.js';

export type DbExecutor = Kysely<DB> | Transaction<DB>;
export type DbTransaction = Transaction<DB>;

let savepointCounter = 0;

function nextSavepointName(): string {
  return `sp_${Date.now()}_${savepointCounter++}`;
}

export async function withTransaction<T>(
  db: DbExecutor,
  callback: (trx: DbTransaction) => Promise<T>
): Promise<T> {
  if (db.isTransaction) {
    return withSavepoint(db as DbTransaction, callback);
  }

  return db.transaction().execute(callback);
}

export async function withSavepoint<T>(
  trx: DbTransaction,
  callback: (trx: DbTransaction) => Promise<T>
): Promise<T> {
  const savepointName = nextSavepointName();

  await sql.raw(`SAVEPOINT ${savepointName}`).execute(trx);

  try {
    const result = await callback(trx);
    await sql.raw(`RELEASE SAVEPOINT ${savepointName}`).execute(trx);
    return result;
  } catch (error) {
    await sql.raw(`ROLLBACK TO SAVEPOINT ${savepointName}`).execute(trx);
    await sql.raw(`RELEASE SAVEPOINT ${savepointName}`).execute(trx);
    throw error;
  }
}
