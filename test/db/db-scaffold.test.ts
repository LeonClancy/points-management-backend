import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/database.js';
import { createMigrationProvider } from '../../src/db/migrate.js';
import * as initialMigration from '../../src/db/migrations/202606100001_initial_schema.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const initialMigrationPath = join(
  currentDir,
  '../../src/db/migrations/202606100001_initial_schema.ts'
);

describe('database scaffold', () => {
  it('can construct and destroy application database clients without connecting', async () => {
    const db = createDb('postgres://points:points@localhost:5432/points');

    try {
      expect(db).toBeDefined();
    } finally {
      await db.destroy();
    }
  });

  it('loads the initial schema migration', async () => {
    const migrations = await createMigrationProvider().getMigrations();

    expect(Object.keys(migrations)).toContain('202606100001_initial_schema');
  });

  it('exports reversible initial migration steps', () => {
    expect(initialMigration.up).toEqual(expect.any(Function));
    expect(initialMigration.down).toEqual(expect.any(Function));
  });

  it('uses PostgreSQL enum types for generated domain unions', async () => {
    const source = await readFile(initialMigrationPath, 'utf8');

    expect(source).toContain('create type point_operation as enum');
    expect(source).toContain('create type point_transaction_status as enum');
    expect(source).toContain('create type ledger_entry_type as enum');
    expect(source).toContain('create type outbox_status as enum');
    expect(source).toContain('sql`point_operation`');
    expect(source).toContain('sql`point_transaction_status`');
    expect(source).toContain('sql`ledger_entry_type`');
    expect(source).toContain('sql`outbox_status`');
  });

  it('declares indexes for reservation recovery, nested children, and outbox polling', async () => {
    const source = await readFile(initialMigrationPath, 'utf8');

    expect(source).toContain('point_transactions_expired_reservations_idx');
    expect(source).toContain('point_transactions_parent_status_idx');
    expect(source).toContain('outbox_events_available_idx');
  });
});
