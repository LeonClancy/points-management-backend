# Points Management Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a runnable Fastify + PostgreSQL backend that satisfies the OpenSpec requirements for recharge, fixed 100-point action reservation, capture, release, nested transactions, consistency, and local operability.

**Architecture:** Use Fastify modules for API boundaries, TypeBox schemas for request/response validation and OpenAPI generation, Kysely + pg for typed SQL access, and PostgreSQL as the transactional source of truth. Point mutations must write wallet projection, business transaction, ledger entry, and outbox event in one database transaction. Long-running action execution must not keep a database transaction open; it uses reserve/capture/release state transitions instead.

**Tech Stack:** Node.js 22 LTS, TypeScript strict mode, Fastify 5, TypeBox, `@fastify/type-provider-typebox`, `@fastify/swagger`, `@fastify/swagger-ui`, PostgreSQL, Kysely, `pg`, `kysely-codegen`, Vitest, Docker Compose.

## Source Requirements

- OpenSpec change: `openspec/changes/design-points-transaction-system`
- Capabilities:
  - `point-wallet-ledger`
  - `point-action-settlement`
  - `transaction-consistency`
  - `project-operability`
- Handoff docs:
  - `AGENTS.md`
  - `docs/work-log.md`

## Implementation Notes

- Keep generated database types committed to git at `src/db/generated.ts`.
- Normally do not manually edit `src/db/generated.ts`; regenerate it after migrations change. The Docker-deferred bootstrap may keep a temporary hand-aligned file, but it must be regenerated and checked inside Docker once Docker is available.
- Use snake_case database columns to match PostgreSQL and reduce mapping ambiguity.
- Use `integer` for point values in this assignment. If product requirements later exceed 2,147,483,647 points per wallet, migrate to `bigint` with explicit `pg` parser/type policy.
- Use explicit service methods for state transitions: `rechargePoints`, `reserveActionPoints`, `captureReservation`, `releaseReservation`, `releaseExpiredReservations`.
- Use row-level locks for wallet and transaction rows that are being mutated.

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/app.ts`
- Create: `src/server.ts`
- Modify: `AGENTS.md`

**Step 1: Create package metadata and scripts**

Create `package.json` with these scripts and dependencies:

```json
{
  "name": "points-management-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22 <23"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:generate-types": "kysely-codegen --config-file .kysely-codegenrc.json",
    "db:check-types": "kysely-codegen --config-file .kysely-codegenrc.json --verify",
    "openspec:validate": "openspec validate \"design-points-transaction-system\""
  },
  "dependencies": {
    "@fastify/swagger": "latest",
    "@fastify/swagger-ui": "latest",
    "@fastify/type-provider-typebox": "latest",
    "@sinclair/typebox": "latest",
    "fastify": "latest",
    "fastify-plugin": "latest",
    "kysely": "latest",
    "pg": "latest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "@types/pg": "latest",
    "kysely-codegen": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

**Step 2: Create strict TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

**Step 3: Add ignore rules**

Create `.gitignore`:

```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
.DS_Store
coverage/
tmp/
postgres-data/
```

**Step 4: Add environment example**

Create `.env.example`:

```dotenv
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgres://points:points@localhost:5432/points
LOG_LEVEL=info
RESERVATION_TTL_SECONDS=900
```

**Step 5: Add minimal app/server**

Create `src/app.ts`:

```ts
import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info'
    }
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.get('/health', async () => ({ status: 'ok' as const }));

  return app;
}
```

Create `src/server.ts`:

```ts
import { buildApp } from './app.js';

const app = await buildApp();

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
```

**Step 6: Run install and build**

Run: `npm install`

Run: `npm run build`

Expected: TypeScript build exits 0.

**Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example src/app.ts src/server.ts AGENTS.md
git commit -m "chore: scaffold fastify typescript project"
```

### Task 2: Docker Compose Local Setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `README.md`
- Modify: `AGENTS.md`

**Step 1: Add Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

**Step 2: Add Docker Compose**

Create `docker-compose.yml`:

```yaml
services:
  app:
    build: .
    environment:
      NODE_ENV: development
      HOST: 0.0.0.0
      PORT: 3000
      DATABASE_URL: postgres://points:points@db:5432/points
      LOG_LEVEL: info
      RESERVATION_TTL_SECONDS: 900
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: points
      POSTGRES_PASSWORD: points
      POSTGRES_DB: points
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U points -d points"]
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

**Step 3: Add setup docs**

Create `README.md` with:

```markdown
# Points Management Backend

## Local Setup

```bash
cp .env.example .env
npm install
docker compose up --build
```

Health check:

```bash
curl http://localhost:3000/health
```

OpenAPI docs will be available at `/docs` after Swagger is registered.
```

**Step 4: Verify compose boot**

Run: `docker compose up --build`

Expected: app logs show Fastify listening and PostgreSQL healthcheck is healthy.

Stop with: `Ctrl-C`

**Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml README.md AGENTS.md
git commit -m "chore: add docker compose local setup"
```

### Task 3: Configuration and Shared Error Model

**Files:**
- Create: `src/config/env.ts`
- Create: `src/shared/errors.ts`
- Create: `src/plugins/error-handler.ts`
- Modify: `src/app.ts`
- Test: `test/config/env.test.ts`

**Step 1: Write failing env tests**

Create `test/config/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

describe('loadEnv', () => {
  it('loads defaults for optional values', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://points:points@localhost:5432/points'
    });

    expect(env.PORT).toBe(3000);
    expect(env.RESERVATION_TTL_SECONDS).toBe(900);
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow('DATABASE_URL');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- test/config/env.test.ts`

Expected: FAIL because `src/config/env.ts` does not exist.

**Step 3: Implement env and error files**

Create `src/config/env.ts`:

```ts
export type AppEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  DATABASE_URL: string;
  LOG_LEVEL: string;
  RESERVATION_TTL_SECONDS: number;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    NODE_ENV: parseNodeEnv(source.NODE_ENV),
    HOST: source.HOST ?? '0.0.0.0',
    PORT: parsePositiveInteger(source.PORT, 3000, 'PORT'),
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: source.LOG_LEVEL ?? 'info',
    RESERVATION_TTL_SECONDS: parsePositiveInteger(
      source.RESERVATION_TTL_SECONDS,
      900,
      'RESERVATION_TTL_SECONDS'
    )
  };
}

function parseNodeEnv(value: string | undefined): AppEnv['NODE_ENV'] {
  if (value === 'production' || value === 'test') return value;
  return 'development';
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
```

Create `src/shared/errors.ts`:

```ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super(message, 409, code, details);
  }
}

export class ValidationAppError extends AppError {
  constructor(message: string, code = 'VALIDATION_ERROR', details?: unknown) {
    super(message, 400, code, details);
  }
}
```

Create `src/plugins/error-handler.ts`:

```ts
import fp from 'fastify-plugin';
import { AppError } from '../shared/errors.js';

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
    }

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error'
      }
    });
  });
});
```

Modify `src/app.ts` to register `errorHandlerPlugin`.

**Step 4: Run test and build**

Run: `npm test -- test/config/env.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/config src/shared src/plugins/error-handler.ts src/app.ts test/config/env.test.ts
git commit -m "chore: add config and error handling"
```

### Task 4: Database Connection, Migrations, and Codegen

**Files:**
- Create: `.kysely-codegenrc.json`
- Create: `src/db/database.ts`
- Create: `src/db/migrate.ts`
- Create: `src/db/migrations/202606100001_initial_schema.ts`
- Create after codegen: `src/db/generated.ts`
- Test: `test/db/db-scaffold.test.ts`

**Step 1: Create codegen config**

Create `.kysely-codegenrc.json`:

```json
{
  "dialect": "postgres",
  "outFile": "./src/db/generated.ts",
  "url": "env(DATABASE_URL)",
  "defaultSchemas": ["public"],
  "camelCase": false,
  "numericParser": "string",
  "dateParser": "timestamp",
  "runtimeEnums": false,
  "typeOnlyImports": true
}
```

**Step 2: Implement Kysely instance**

Create `src/db/database.ts`:

```ts
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './generated.js';

export function createDb(databaseUrl: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl,
        max: 10
      })
    })
  });
}
```

**Step 3: Create initial migration**

Create `src/db/migrations/202606100001_initial_schema.ts` with Kysely schema builder and raw SQL for constraints where needed:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists "pgcrypto"`.execute(db);
  await sql`
    do $$
    begin
      create type point_operation as enum ('RECHARGE', 'ACTION');
    exception
      when duplicate_object then null;
    end $$;
  `.execute(db);
  await sql`
    do $$
    begin
      create type point_transaction_status as enum (
        'RECHARGED',
        'RESERVED',
        'CAPTURED',
        'RELEASED',
        'FAILED'
      );
    exception
      when duplicate_object then null;
    end $$;
  `.execute(db);
  await sql`
    do $$
    begin
      create type ledger_entry_type as enum (
        'RECHARGE',
        'RESERVE',
        'CAPTURE',
        'RELEASE',
        'ADJUSTMENT'
      );
    exception
      when duplicate_object then null;
    end $$;
  `.execute(db);
  await sql`
    do $$
    begin
      create type outbox_status as enum ('PENDING', 'PUBLISHED', 'FAILED');
    exception
      when duplicate_object then null;
    end $$;
  `.execute(db);

  await db.schema
    .createTable('wallets')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().unique())
    .addColumn('available_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('held_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('wallets_available_points_non_negative', sql`available_points >= 0`)
    .addCheckConstraint('wallets_held_points_non_negative', sql`held_points >= 0`)
    .execute();

  await db.schema
    .createTable('point_transactions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('wallet_id', 'uuid', (col) => col.notNull().references('wallets.id'))
    .addColumn('parent_transaction_id', 'uuid', (col) =>
      col.references('point_transactions.id')
    )
    .addColumn('operation', sql`point_operation`, (col) => col.notNull())
    .addColumn('status', sql`point_transaction_status`, (col) => col.notNull())
    .addColumn('amount', 'integer', (col) => col.notNull())
    .addColumn('idempotency_scope', 'text', (col) => col.notNull())
    .addColumn('idempotency_key', 'text', (col) => col.notNull())
    .addColumn('request_hash', 'text', (col) => col.notNull())
    .addColumn('response_payload', 'jsonb')
    .addColumn('expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('point_transactions_amount_positive', sql`amount > 0`)
    .execute();

  await db.schema
    .createIndex('point_transactions_idempotency_unique')
    .on('point_transactions')
    .columns(['idempotency_scope', 'idempotency_key'])
    .unique()
    .execute();

  await db.schema
    .createIndex('point_transactions_wallet_status_idx')
    .on('point_transactions')
    .columns(['wallet_id', 'status'])
    .execute();

  await db.schema
    .createIndex('point_transactions_expired_reservations_idx')
    .on('point_transactions')
    .columns(['status', 'expires_at'])
    .where('status', '=', 'RESERVED')
    .where('expires_at', 'is not', null)
    .execute();

  await db.schema
    .createIndex('point_transactions_parent_status_idx')
    .on('point_transactions')
    .columns(['parent_transaction_id', 'status'])
    .where('parent_transaction_id', 'is not', null)
    .execute();

  await db.schema
    .createTable('point_ledger_entries')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('wallet_id', 'uuid', (col) => col.notNull().references('wallets.id'))
    .addColumn('transaction_id', 'uuid', (col) =>
      col.notNull().references('point_transactions.id')
    )
    .addColumn('entry_type', sql`ledger_entry_type`, (col) => col.notNull())
    .addColumn('available_delta', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('held_delta', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('point_ledger_entries_wallet_idx')
    .on('point_ledger_entries')
    .columns(['wallet_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('outbox_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('aggregate_type', 'text', (col) => col.notNull())
    .addColumn('aggregate_id', 'uuid', (col) => col.notNull())
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('status', sql`outbox_status`, (col) =>
      col.notNull().defaultTo(sql`'PENDING'::outbox_status`)
    )
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('available_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('published_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('outbox_events_attempts_non_negative', sql`attempts >= 0`)
    .execute();

  await db.schema
    .createIndex('outbox_events_available_idx')
    .on('outbox_events')
    .columns(['status', 'available_at'])
    .where('status', '=', 'PENDING')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('outbox_events').ifExists().execute();
  await db.schema.dropTable('point_ledger_entries').ifExists().execute();
  await db.schema.dropTable('point_transactions').ifExists().execute();
  await db.schema.dropTable('wallets').ifExists().execute();
  await sql`drop type if exists outbox_status`.execute(db);
  await sql`drop type if exists ledger_entry_type`.execute(db);
  await sql`drop type if exists point_transaction_status`.execute(db);
  await sql`drop type if exists point_operation`.execute(db);
}
```

**Step 4: Implement migration runner**

Create `src/db/migrate.ts` using Kysely `Migrator` and `FileMigrationProvider`.

**Step 5: Run migration and generate types**

Run: `docker compose up -d db`

Run: `docker compose run --rm app npm run db:migrate`

Run: `docker compose run --rm app npm run db:generate-types`

Expected: `src/db/generated.ts` is created.

**Step 6: Verify generated types are current**

Run: `docker compose run --rm app npm run db:check-types`

Expected: command exits 0.

**Step 7: Commit**

```bash
git add .kysely-codegenrc.json src/db test/db
git commit -m "feat: add database schema and generated types"
```

### Task 5: Transaction Manager and Savepoints

**Files:**
- Create: `src/db/transaction.ts`
- Test: `test/db/transaction.test.ts`

**Step 1: Write failing tests**

Create tests for:

- outer transaction commits when callback succeeds
- outer transaction rolls back when callback throws
- savepoint rollback discards inner writes while retaining earlier writes

**Step 2: Implement transaction helpers**

Create `src/db/transaction.ts`:

```ts
import { Kysely, sql, Transaction } from 'kysely';
import type { DB } from './generated.js';

export type DbExecutor = Kysely<DB> | Transaction<DB>;
export type DbTransaction = Transaction<DB>;

let savepointCounter = 0;

export async function withTransaction<T>(
  db: Kysely<DB>,
  callback: (trx: DbTransaction) => Promise<T>
): Promise<T> {
  return db.transaction().execute(callback);
}

export async function withSavepoint<T>(
  trx: DbTransaction,
  callback: (trx: DbTransaction) => Promise<T>
): Promise<T> {
  const name = `sp_${Date.now()}_${savepointCounter++}`;

  await sql.raw(`SAVEPOINT ${name}`).execute(trx);

  try {
    const result = await callback(trx);
    await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(trx);
    return result;
  } catch (error) {
    await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(trx);
    await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(trx);
    throw error;
  }
}
```

Only generated savepoint names may be interpolated into raw SQL.

**Step 3: Run tests**

Run: `npm test -- test/db/transaction.test.ts`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/db/transaction.ts test/db/transaction.test.ts
git commit -m "feat: add transaction savepoint helpers"
```

### Task 6: Wallet, Transaction, Ledger, and Outbox Repositories

**Files:**
- Create: `src/modules/wallets/wallet.repository.ts`
- Create: `src/modules/points/point-transaction.repository.ts`
- Create: `src/modules/points/ledger.repository.ts`
- Create: `src/modules/outbox/outbox.repository.ts`
- Test: `test/modules/repositories.test.ts`

**Step 1: Write repository tests**

Cover:

- wallet creation by `user_id`
- wallet row lock method uses `.forUpdate()`
- transaction lookup by idempotency scope/key
- ledger append creates immutable rows
- outbox append stores `PENDING` event

**Step 2: Implement wallet repository**

Required methods:

```ts
export async function findWalletByUserIdForUpdate(db: DbExecutor, userId: string) { /* ... */ }
export async function createWallet(db: DbExecutor, userId: string) { /* ... */ }
export async function updateWalletBalances(db: DbExecutor, input: {
  walletId: string;
  availableDelta: number;
  heldDelta: number;
}) { /* ... */ }
```

`updateWalletBalances` must update with database-side arithmetic and rely on check constraints to reject negative balances.

**Step 3: Implement transaction repository**

Required methods:

```ts
export async function findByIdempotencyForUpdate(db: DbExecutor, scope: string, key: string) { /* ... */ }
export async function createPointTransaction(db: DbExecutor, input: CreatePointTransactionInput) { /* ... */ }
export async function findTransactionForUpdate(db: DbExecutor, id: string) { /* ... */ }
export async function updateTransactionStatus(db: DbExecutor, input: UpdateTransactionStatusInput) { /* ... */ }
```

**Step 4: Implement ledger and outbox repositories**

Ledger rows are append-only. Do not expose update/delete helpers for ledger entries.

**Step 5: Run tests**

Run: `npm test -- test/modules/repositories.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/modules test/modules/repositories.test.ts
git commit -m "feat: add point accounting repositories"
```

### Task 7: Idempotency and Request Hashing

**Files:**
- Create: `src/modules/points/idempotency.ts`
- Test: `test/modules/idempotency.test.ts`

**Step 1: Write failing tests**

Cover:

- same JSON payload produces same hash
- object key order does not change hash
- changed amount or user id changes hash
- existing transaction with different hash returns conflict

**Step 2: Implement stable hashing**

Implement deterministic JSON serialization and SHA-256 hash:

```ts
import { createHash } from 'node:crypto';
import { ConflictError } from '../../shared/errors.js';

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function assertSameRequestHash(existing: string, incoming: string): void {
  if (existing !== incoming) {
    throw new ConflictError('Idempotency key was reused with a different payload', 'IDEMPOTENCY_CONFLICT');
  }
}
```

**Step 3: Run tests**

Run: `npm test -- test/modules/idempotency.test.ts`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/modules/points/idempotency.ts test/modules/idempotency.test.ts
git commit -m "feat: add idempotency payload hashing"
```

### Task 8: Point Service - Recharge

**Files:**
- Create: `src/modules/points/point.service.ts`
- Test: `test/modules/point-service.recharge.test.ts`

**Step 1: Write failing integration tests**

Cover OpenSpec `point-wallet-ledger`:

- first recharge creates wallet and increases `available_points`
- repeated recharge with same idempotency key returns existing result
- repeated recharge with same key and different payload returns conflict
- ledger has one recharge entry
- outbox has one recharge event

**Step 2: Implement `rechargePoints`**

Signature:

```ts
export async function rechargePoints(input: {
  user_id: string;
  amount: number;
  idempotency_key: string;
}): Promise<RechargeResult> {
  // withTransaction(db, async trx => ...)
}
```

Rules:

- reject `amount <= 0`
- create wallet if missing
- lock wallet before mutation
- create or reuse idempotent transaction
- update `available_points += amount`
- insert ledger entry `{ entry_type: 'RECHARGE', available_delta: amount, held_delta: 0 }`
- insert outbox event `points.recharged`
- store response payload on transaction

**Step 3: Run tests**

Run: `npm test -- test/modules/point-service.recharge.test.ts`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/modules/points/point.service.ts test/modules/point-service.recharge.test.ts
git commit -m "feat: implement idempotent point recharge"
```

### Task 9: Point Service - Reserve, Capture, Release

**Files:**
- Modify: `src/modules/points/point.service.ts`
- Test: `test/modules/point-service.action-settlement.test.ts`

**Step 1: Write failing tests**

Cover OpenSpec `point-action-settlement`:

- reserve succeeds when `available_points >= 100`
- reserve fails when `available_points < 100`
- reserve moves 100 from available to held
- capture only works from `RESERVED`
- capture retry does not double deduct
- release only works from `RESERVED`
- release retry does not double refund
- terminal transaction cannot transition again

**Step 2: Implement reserve**

`reserveActionPoints` must:

- lock or create wallet by user
- reject insufficient available points before action execution
- create `RESERVED` transaction with `expires_at`
- update wallet by `available_delta: -100`, `held_delta: 100`
- append ledger entry `RESERVE`
- append outbox event `points.reserved`

**Step 3: Implement capture**

`captureReservation` must:

- lock `point_transactions` row
- return existing result if already `CAPTURED`
- reject if status is `RELEASED` or `FAILED`
- lock wallet
- update wallet by `available_delta: 0`, `held_delta: -100`
- update status to `CAPTURED`
- append ledger entry `CAPTURE`
- append outbox event `points.captured`

**Step 4: Implement release**

`releaseReservation` must:

- lock `point_transactions` row
- return existing result if already `RELEASED`
- reject if status is `CAPTURED`
- lock wallet
- update wallet by `available_delta: 100`, `held_delta: -100`
- update status to `RELEASED`
- append ledger entry `RELEASE`
- append outbox event `points.released`

**Step 5: Run tests**

Run: `npm test -- test/modules/point-service.action-settlement.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/modules/points/point.service.ts test/modules/point-service.action-settlement.test.ts
git commit -m "feat: implement action point settlement"
```

### Task 10: Concurrency and Atomicity Tests

**Files:**
- Test: `test/modules/point-service.concurrency.test.ts`
- Modify as needed: `src/modules/points/point.service.ts`
- Modify as needed: repository files

**Step 1: Write failing concurrency tests**

Cover OpenSpec `transaction-consistency`:

- two concurrent reserves against one 100-point wallet result in one success and one insufficient-points failure
- failed ledger insert rolls back wallet mutation
- outbox event is not visible when operation rolls back

**Step 2: Run tests to verify failures**

Run: `npm test -- test/modules/point-service.concurrency.test.ts`

Expected: FAIL until row locking and transaction boundaries are complete.

**Step 3: Fix service/repository transaction boundaries**

Use:

- `SELECT ... FOR UPDATE` via Kysely `.forUpdate()`
- one `withTransaction` boundary for wallet update, transaction update, ledger insert, and outbox insert
- explicit errors for insufficient points and invalid state transitions

**Step 4: Run tests**

Run: `npm test -- test/modules/point-service.concurrency.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/modules test/modules/point-service.concurrency.test.ts
git commit -m "test: cover point transaction concurrency"
```

### Task 11: Nested Business Transactions

**Files:**
- Create: `src/modules/points/parent-transaction.service.ts`
- Modify: `src/modules/points/point.service.ts`
- Test: `test/modules/parent-transaction.test.ts`

**Step 1: Write failing tests**

Cover OpenSpec business nested transactions:

- child transaction stores `parent_transaction_id`
- parent failure releases all child transactions still in `RESERVED`
- child already `CAPTURED` is not released
- repeated parent failure handling is idempotent

**Step 2: Implement parent workflow helpers**

Implement:

```ts
export async function failParentTransaction(input: {
  parent_transaction_id: string;
  reason: string;
}): Promise<void> {
  // lock parent, find reserved children, release each idempotently, mark parent failed
}
```

**Step 3: Use savepoint helper in multi-child release**

Each child release can run in a savepoint so one child failure can be isolated and reported while retaining prior parent-level state when appropriate.

**Step 4: Run tests**

Run: `npm test -- test/modules/parent-transaction.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/modules/points test/modules/parent-transaction.test.ts
git commit -m "feat: add nested business transaction handling"
```

### Task 12: Recovery and Reconciliation

**Files:**
- Create: `src/modules/points/recovery.service.ts`
- Create: `src/modules/points/reconciliation.service.ts`
- Test: `test/modules/recovery.test.ts`
- Test: `test/modules/reconciliation.test.ts`

**Step 1: Write failing recovery tests**

Cover:

- expired `RESERVED` transaction is released
- already `CAPTURED` reservation is ignored
- already `RELEASED` reservation is ignored

**Step 2: Implement `releaseExpiredReservations`**

Find reserved transactions where `expires_at < now()` and call `releaseReservation` with a deterministic recovery idempotency key.

**Step 3: Write failing reconciliation tests**

Cover:

- wallet projection matches ledger deltas
- drift is reported

**Step 4: Implement reconciliation**

Implement:

```ts
export async function reconcileWallet(userId: string): Promise<{
  consistent: boolean;
  wallet_available_points: number;
  wallet_held_points: number;
  ledger_available_points: number;
  ledger_held_points: number;
}> {
  // sum ledger available_delta and held_delta and compare with wallet row
}
```

**Step 5: Run tests**

Run: `npm test -- test/modules/recovery.test.ts test/modules/reconciliation.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/modules/points test/modules/recovery.test.ts test/modules/reconciliation.test.ts
git commit -m "feat: add reservation recovery and reconciliation"
```

### Task 13: API Schemas, Routes, and Swagger

**Files:**
- Create: `src/plugins/swagger.ts`
- Create: `src/modules/health/health.routes.ts`
- Create: `src/modules/wallets/wallet.schemas.ts`
- Create: `src/modules/wallets/wallet.routes.ts`
- Create: `src/modules/actions/action.schemas.ts`
- Create: `src/modules/actions/action.routes.ts`
- Modify: `src/app.ts`
- Test: `test/http/routes.test.ts`

**Step 1: Write failing route tests**

Use Fastify `app.inject`.

Cover:

- `GET /health`
- `POST /wallets/recharge`
- `GET /wallets/:user_id`
- `POST /actions/reserve`
- `POST /actions/:transaction_id/capture`
- `POST /actions/:transaction_id/release`
- `/docs` serves Swagger UI

**Step 2: Implement Swagger plugin**

Register `@fastify/swagger` before routes:

```ts
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';

export const swaggerPlugin = fp(async (app) => {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Points Management Backend',
        version: '0.1.0'
      }
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs'
  });
});
```

**Step 3: Implement TypeBox schemas**

Use TypeBox objects for body, params, and response. All money/point amounts must be integers.

**Step 4: Implement route handlers**

Routes call service methods only. Do not put SQL in route handlers.

**Step 5: Run tests and inspect docs**

Run: `npm test -- test/http/routes.test.ts`

Expected: PASS.

Run app and open: `http://localhost:3000/docs`

Expected: Swagger UI lists wallet and action endpoints.

**Step 6: Commit**

```bash
git add src/plugins/swagger.ts src/modules test/http/routes.test.ts src/app.ts
git commit -m "feat: expose point management api"
```

### Task 14: OpenSpec and Architecture Documentation

**Files:**
- Create: `docs/architecture.md`
- Modify: `docs/work-log.md`
- Modify: `AGENTS.md`
- Modify as needed: `openspec/changes/design-points-transaction-system/tasks.md`

**Step 1: Create final architecture document**

`docs/architecture.md` must include:

- problem understanding
- system design
- database choice and trade-offs
- data model
- recharge/reserve/capture/release transaction flows
- nested transaction design
- consistency and error handling
- production readiness
- local setup
- AI collaboration notes

**Step 2: Update handoff docs**

Update `AGENTS.md` with real commands:

```bash
npm install
docker compose up --build
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:generate-types
docker compose run --rm app npm run db:check-types
npm test
npm run build
openspec validate "design-points-transaction-system"
```

Update `docs/work-log.md` with implementation decisions and manual changes.

**Step 3: Check OpenSpec tasks**

Mark implementation-relevant tasks complete only after the corresponding code and docs exist. Keep unchecked items that still belong to Private Gist delivery.

**Step 4: Run validation**

Run: `npm run build`

Run: `npm test`

Run: `openspec validate "design-points-transaction-system"`

Expected: all exit 0.

**Step 5: Commit**

```bash
git add docs AGENTS.md openspec
git commit -m "docs: add architecture and implementation handoff"
```

### Task 15: Final Verification and Delivery Prep

**Files:**
- Modify as needed: `README.md`
- Modify as needed: `docs/architecture.md`
- Modify as needed: `docs/work-log.md`

**Step 1: Full local reset verification**

Run:

```bash
docker compose down -v
docker compose up --build
```

Expected:

- PostgreSQL becomes healthy.
- app starts.
- `GET /health` returns `{ "status": "ok" }`.

**Step 2: Full command verification**

In another shell, run:

```bash
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:check-types
npm run build
npm test
openspec validate "design-points-transaction-system"
```

Expected: all exit 0.

**Step 3: Manual smoke flow**

Run:

```bash
curl -X POST http://localhost:3000/wallets/recharge \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","amount":200,"idempotency_key":"manual-recharge-1"}'

curl -X POST http://localhost:3000/actions/reserve \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","action_id":"manual-action-1","idempotency_key":"manual-reserve-1"}'
```

Expected:

- recharge increases available points
- reserve moves 100 points into held points
- retrying each request with the same idempotency key returns the same result

**Step 4: Commit final verification docs**

```bash
git add README.md docs AGENTS.md
git commit -m "docs: record final verification steps"
```

## Requirement Coverage Checklist

- `point-wallet-ledger`
  - Wallet projection: Tasks 4, 6, 8
  - Recharge: Task 8
  - Append-only ledger: Tasks 4, 6, 8, 9
  - Reconciliation: Task 12
- `point-action-settlement`
  - Reserve: Task 9
  - Capture: Task 9
  - Release: Task 9
  - Expiry: Task 12
- `transaction-consistency`
  - Atomic writes: Tasks 5, 8, 9, 10
  - Concurrent wallet serialization: Task 10
  - Idempotency: Tasks 7, 8, 9
  - Database savepoints: Task 5
  - Business nested transactions: Task 11
  - Outbox: Tasks 4, 6, 8, 9
- `project-operability`
  - AGENTS handoff: Tasks 1, 14
  - Docker Compose: Task 2
  - Setup docs: Tasks 2, 14, 15

## Execution Handoff

Plan complete and saved to `docs/plans/2026-06-10-points-management-backend-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** - Open a new session with `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
