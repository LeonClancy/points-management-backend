import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import {
  FileMigrationProvider,
  Migrator,
  type MigrationResultSet
} from 'kysely/migration';
import { Pool } from 'pg';
import { loadEnv } from '../config/env.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationFolder = join(currentDir, 'migrations');

export function createMigrationDb(databaseUrl: string): Kysely<unknown> {
  return new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl,
        max: 1
      })
    })
  });
}

export function createMigrator(db: Kysely<unknown>): Migrator {
  return new Migrator({
    db,
    provider: createMigrationProvider()
  });
}

export function createMigrationProvider(): FileMigrationProvider {
  return new FileMigrationProvider({
    fs,
    path: { join },
    migrationFolder,
    import: async (filePath) => import(pathToFileURL(filePath).href)
  });
}

export async function migrateToLatest(db: Kysely<unknown>): Promise<MigrationResultSet> {
  return createMigrator(db).migrateToLatest();
}

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createMigrationDb(env.DATABASE_URL);

  try {
    const result = await migrateToLatest(db);

    for (const migration of result.results ?? []) {
      console.log(`${migration.migrationName}: ${migration.status}`);
    }

    if (result.error) {
      throw result.error;
    }
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
