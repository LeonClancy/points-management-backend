# Points Management Backend Architecture

## Problem Understanding

This project implements a transactional point management backend. The core domain is not a simple balance counter: it must handle point recharge, a fixed 100-point action cost, successful deduction, failure refund, retry safety, nested business workflows, consistency under concurrency, and production-oriented recovery.

The action lifecycle is:

1. Recharge credits a user's wallet.
2. Reserve moves 100 points from `available_points` to `held_points` before an external action runs.
3. Capture finalizes a successful action by removing 100 held points.
4. Release refunds a failed, cancelled, or expired action by moving 100 held points back to available.

Wallet balances are operational projections. Ledger entries are the audit source used for reconciliation.

## Technology Choices

The implemented stack is Node.js with Fastify, PostgreSQL, Kysely, `pg`, TypeBox schemas, and Swagger/OpenAPI docs.

PostgreSQL is selected because this assignment depends on transactional correctness. It provides row-level locks, check constraints, unique indexes, transactional DDL/migrations, JSONB response payload storage, and `SAVEPOINT` for database-level nested transactions.

Trade-offs:

- PostgreSQL vs MySQL: both can work, but PostgreSQL has strong JSONB support, mature partial indexes, and straightforward savepoint behavior.
- PostgreSQL vs Redis: Redis is useful for fast counters, but it is weaker as the system of record for ledger audit, reconciliation, and multi-row transactional writes.
- PostgreSQL projection + ledger vs pure event sourcing: pure event sourcing can work, but it adds replay, snapshot, and event schema complexity. This project uses a simpler append-only ledger plus wallet projection pattern.
- Kysely + `pg`: Kysely gives typed SQL construction without hiding transaction boundaries behind a heavy ORM. `kysely-codegen` generates DB types from the live schema.

## Data Model

`wallets`

- One row per user.
- Stores `available_points`, `held_points`, and `version`.
- Check constraints prevent negative balances.
- `user_id` is unique.

`point_transactions`

- Stores business operations and state.
- `operation` is `RECHARGE` or `ACTION`.
- `status` is `RECHARGED`, `RESERVED`, `CAPTURED`, `RELEASED`, or `FAILED`.
- `(idempotency_scope, idempotency_key)` is unique.
- `request_hash` detects key reuse with different payloads.
- `response_payload` stores the idempotent response.
- `parent_transaction_id` links child transactions to a parent workflow.
- `expires_at` supports reservation recovery.

`point_ledger_entries`

- Append-only point movement log.
- Entry types are `RECHARGE`, `RESERVE`, `CAPTURE`, `RELEASE`, and `ADJUSTMENT`.
- Corrections must be compensating entries, not edits.

`outbox_events`

- Stores side effects in the same transaction as point mutations.
- Events start as `PENDING`.
- A future publisher can atomically claim and publish events after commit.

## Transaction Flows

Recharge:

1. Validate amount is a positive integer.
2. Look up existing idempotency transaction by operation/user scope and key.
3. If found, compare request hash and return stored response.
4. Lock or create the wallet.
5. Create a `RECHARGED` point transaction.
6. Increase `available_points`.
7. Append `RECHARGE` ledger entry.
8. Write `points.recharged` outbox event.
9. Store response payload on the point transaction.

Reserve:

1. Look up existing reserve by idempotency scope and key.
2. Lock or create the wallet.
3. Reject with `INSUFFICIENT_POINTS` if `available_points < 100`.
4. Create a `RESERVED` action transaction.
5. Move 100 points from available to held.
6. Append `RESERVE` ledger entry.
7. Write `points.reserved` outbox event.
8. Store response payload.

Capture:

1. Lock the point transaction.
2. If already `CAPTURED`, return stored response.
3. Reject if not `RESERVED`.
4. Lock the wallet.
5. Decrease `held_points` by 100.
6. Mark transaction `CAPTURED`.
7. Append `CAPTURE` ledger entry.
8. Write `points.captured` outbox event.

Release:

1. Lock the point transaction.
2. If already `RELEASED`, return stored response.
3. Reject if not `RESERVED`.
4. Lock the wallet.
5. Move 100 points from held back to available.
6. Mark transaction `RELEASED`.
7. Append `RELEASE` ledger entry.
8. Write `points.released` outbox event.

Valid state transitions:

- `RECHARGED` is terminal.
- `RESERVED -> CAPTURED`
- `RESERVED -> RELEASED`
- `RESERVED -> FAILED` for parent workflow records.
- `CAPTURED`, `RELEASED`, and `FAILED` are terminal for action settlement.

## Consistency

Point mutations are wrapped in one database transaction. Wallet updates, point transaction writes, ledger entries, and outbox events become visible together after commit. If any write fails, all writes roll back.

Concurrency control uses `SELECT ... FOR UPDATE` row locks on wallet rows and point transaction rows. Concurrent reserve requests serialize on the same wallet row, so the second request evaluates the updated balance after the first commits.

Idempotency is required for externally retried operations. A retry with the same scope/key and same request hash returns the stored result. A retry with the same scope/key but different payload returns `IDEMPOTENCY_CONFLICT`.

Reconciliation compares wallet projection balances to ledger sums:

- `wallet.available_points == sum(ledger.available_delta)`
- `wallet.held_points == sum(ledger.held_delta)`

Detected drift is reported for investigation before automated correction.

## Nested Transactions

There are two nested transaction levels.

Database-level nesting uses PostgreSQL `SAVEPOINT`. `withTransaction` starts a transaction when given a root DB instance. When called inside an existing transaction, it creates a savepoint, rolls back to it on inner failure, and keeps the outer transaction alive.

Business-level nesting uses `point_transactions.parent_transaction_id`. A parent workflow can own child reservations. When `failParentTransaction` runs, it locks the parent, releases children still in `RESERVED`, ignores already `CAPTURED` children, and marks the parent `FAILED`.

Database transactions are intentionally short-lived. The external action should not run while a DB transaction is open.

## Recovery

Reservations have `expires_at`. `releaseExpiredReservations` locks expired `RESERVED` transactions and calls the normal release path. Already `CAPTURED` or `RELEASED` reservations are ignored because recovery only selects `RESERVED` rows.

In production this should run as a scheduled worker with metrics for scanned, released, skipped, failed, and retried reservations.

## Outbox and Side Effects

External side effects should be published from `outbox_events`, not directly from request handlers. This prevents notifying another system about a point mutation that later rolls back.

The current implementation writes outbox rows. A production publisher should:

- Claim pending rows in batches.
- Publish idempotently.
- Increment attempts.
- Mark rows `PUBLISHED` or `FAILED`.
- Alert on repeated failures and old pending rows.

## Operational Readiness

Recommended production controls:

- Authentication and authorization for user-scoped wallet/actions APIs.
- Rate limiting for write endpoints.
- Idempotency key retention policy.
- Request tracing with transaction ids and idempotency keys.
- Metrics for reserve conflicts, insufficient points, retries, recovery releases, and reconciliation drift.
- Database backups, restore drills, and migration rollback plans.
- Read replicas only for non-mutating read models; point mutations must use the primary DB.
- Load testing around hot-wallet contention.

## Local Setup

The project is runnable with Docker Compose:

```bash
cp .env.example .env
docker compose up --build
```

In another shell:

```bash
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:check-types
docker compose run --rm app npm test
```

Health and docs:

```bash
curl -sS http://localhost:3000/health
open http://localhost:3000/docs
```

Reset:

```bash
docker compose down -v
```

## Verification

Useful commands:

```bash
npm run typecheck
npm run build
docker compose run --rm app npm test
docker compose run --rm app npm run db:check-types
openspec validate "design-points-transaction-system"
```

Manual smoke flow:

```bash
curl -sS -X POST http://localhost:3000/wallets/recharge \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","amount":200,"idempotency_key":"manual-recharge-1"}'

curl -sS -X POST http://localhost:3000/actions/reserve \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","action_id":"manual-action-1","idempotency_key":"manual-reserve-1"}'
```

## AI Collaboration Notes

`docs/work-log.md` records the AI-assisted reasoning and implementation checkpoints. The important decisions were:

- Use PostgreSQL as the source of truth.
- Use wallet projection plus append-only ledger.
- Keep database nested transactions separate from business parent-child workflows.
- Run database migration/codegen/test verification through Docker Compose.
- Commit generated Kysely DB types so the project typechecks before a local DB is running.
