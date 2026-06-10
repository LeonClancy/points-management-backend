# AGENTS.md

## Project Overview

This repository is a backend engineering assignment for a transactional point management system. The assignment asks for recharge, fixed 100-point action cost, successful deduction, failure refund, nested transactions, consistency, and production readiness.

Implementation is in progress. The current source of truth is the OpenSpec change, supporting docs, and the Fastify application scaffold.

## Required First Step

Run the Superpowers bootstrap before starting agent work:

```bash
~/.codex/superpowers/.codex/superpowers-codex bootstrap
```

Then follow any applicable skill instructions before changing files.

## Key Files

- `docs/context.md`: Original assignment prompt.
- `docs/work-log.md`: Work log for AI-assisted analysis and manual design decisions.
- `docs/plans/2026-06-10-points-management-backend-implementation.md`: Current implementation plan.
- `package.json`: Node.js scripts and dependencies.
- `src/app.ts`: Fastify app builder.
- `src/server.ts`: HTTP server entrypoint.
- `src/db/migrations/`: Kysely migrations for PostgreSQL schema.
- `src/db/generated.ts`: Kysely DB types. Regenerate with `npm run db:generate-types` inside Docker after migration changes.
- `docker-compose.yml`: Local app and PostgreSQL startup.
- `openspec/config.yaml`: OpenSpec configuration.
- `openspec/changes/design-points-transaction-system/proposal.md`: Change motivation and capability list.
- `openspec/changes/design-points-transaction-system/design.md`: Technical design decisions.
- `openspec/changes/design-points-transaction-system/specs/`: Requirement specs.
- `openspec/changes/design-points-transaction-system/tasks.md`: Delivery checklist.

## Current OpenSpec Change

Change name:

```bash
design-points-transaction-system
```

Validate it with:

```bash
openspec validate "design-points-transaction-system"
openspec status --change "design-points-transaction-system"
npm run typecheck
npm test
docker compose run --rm app npm test
npm run build
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:generate-types
docker compose run --rm app npm run db:check-types
```

## Design Direction

The selected point-system design uses:

- PostgreSQL as the source of truth.
- Wallet balance projection with `available_points` and `held_points`.
- Append-only ledger entries for audit and reconciliation.
- Reserve/capture/release lifecycle for actions that cost 100 points.
- Idempotency keys for retry safety.
- Row-level locking or version checks to prevent overspending.
- PostgreSQL `SAVEPOINT` for database-level nested transactions.
- Parent-child point transactions for business-level nested workflows.
- Outbox events for side effects after commit.

## Operability Requirement

Ease of setup is now a non-functional requirement.

The repository has a minimal runnable Fastify scaffold and Docker Compose support. Start the app and PostgreSQL with:

```bash
docker compose up --build
```

The Compose setup should include:

- Application service.
- PostgreSQL service.
- Required environment variables or `.env.example`.
- Migration/setup command.
- Health checks where practical.
- Clear shutdown/reset instructions.

## Editing Guidance

- Keep the final deliverable Markdown-oriented unless implementation is explicitly requested.
- Update `docs/work-log.md` when AI-assisted analysis or manual design decisions change.
- Update OpenSpec specs/tasks when adding or changing requirements.
- Run database migration/codegen commands through Docker Compose. Do not use local `psql`, `postgres`, or `initdb` as a shortcut.
- Run OpenSpec validation before claiming the design artifacts are valid.
