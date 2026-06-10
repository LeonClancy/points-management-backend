import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/database.js';
import { withTransaction } from '../../src/db/transaction.js';
import type { DB } from '../../src/db/generated.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

async function insertLabel(db: Kysely<DB>, label: string): Promise<void> {
  await sql`insert into transaction_test_entries (label) values (${label})`.execute(db);
}

async function countLabel(db: Kysely<DB>, label: string): Promise<number> {
  const result = await sql<{ count: number }>`
    select count(*)::int as count
    from transaction_test_entries
    where label = ${label}
  `.execute(db);

  return result.rows[0]?.count ?? 0;
}

describeWithDb('transaction helpers', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = createDb(databaseUrl!);
    await sql`
      create table if not exists transaction_test_entries (
        id serial primary key,
        label text not null
      )
    `.execute(db);
  });

  beforeEach(async () => {
    await sql`truncate table transaction_test_entries`.execute(db);
  });

  afterAll(async () => {
    await sql`drop table if exists transaction_test_entries`.execute(db);
    await db.destroy();
  });

  it('commits an outer transaction when the callback succeeds', async () => {
    const result = await withTransaction(db, async (trx) => {
      await insertLabel(trx, 'outer-commit');

      return 'committed';
    });

    expect(result).toBe('committed');
    expect(await countLabel(db, 'outer-commit')).toBe(1);
  });

  it('rolls back an outer transaction when the callback throws', async () => {
    await expect(
      withTransaction(db, async (trx) => {
        await insertLabel(trx, 'outer-rollback');
        throw new Error('outer failed');
      })
    ).rejects.toThrow('outer failed');

    expect(await countLabel(db, 'outer-rollback')).toBe(0);
  });

  it('rolls back a failed nested transaction to its savepoint while retaining outer writes', async () => {
    await withTransaction(db, async (outerTrx) => {
      await insertLabel(outerTrx, 'outer-before');

      await expect(
        withTransaction(outerTrx, async (innerTrx) => {
          await insertLabel(innerTrx, 'inner-rollback');
          throw new Error('inner failed');
        })
      ).rejects.toThrow('inner failed');

      await insertLabel(outerTrx, 'outer-after');
    });

    expect(await countLabel(db, 'outer-before')).toBe(1);
    expect(await countLabel(db, 'inner-rollback')).toBe(0);
    expect(await countLabel(db, 'outer-after')).toBe(1);
  });

  it('rolls back successful nested writes when the outer transaction later fails', async () => {
    await expect(
      withTransaction(db, async (outerTrx) => {
        await insertLabel(outerTrx, 'outer-before-failure');

        await withTransaction(outerTrx, async (innerTrx) => {
          await insertLabel(innerTrx, 'inner-success-before-outer-failure');
        });

        throw new Error('outer failed after inner success');
      })
    ).rejects.toThrow('outer failed after inner success');

    expect(await countLabel(db, 'outer-before-failure')).toBe(0);
    expect(await countLabel(db, 'inner-success-before-outer-failure')).toBe(0);
  });
});
