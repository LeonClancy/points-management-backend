# Work Log

## 2026-06-10 16:05 CST - Assignment Intake

- Received the assignment in `docs/context.md`.
- Reviewed the prompt and identified the required deliverable as a Markdown architecture document for a transactional point system.
- Initial interpretation: the assignment is primarily about backend accounting correctness, transaction boundaries, nested transactions, consistency, and production readiness rather than CRUD implementation.

## 2026-06-10 16:08 CST - Design Direction

- Used AI agent discussion to compare possible approaches for action point deduction.
- Selected a reservation-based model as the strongest direction:
  - Reserve 100 points when an action starts.
  - Capture the reservation when the action succeeds.
  - Release the reservation when the action fails, is cancelled, or expires.
- Chose PostgreSQL as the recommended database because it provides ACID transactions, row-level locks, constraints, and `SAVEPOINT` support for nested transaction handling.
- Decided to pair wallet balance projections with append-only ledger entries so the system supports both efficient reads and audit/reconciliation.

## 2026-06-10 16:10 CST - OpenSpec Setup

- Used OpenSpec to structure the requirement analysis.
- Created change: `design-points-transaction-system`.
- Generated the proposal artifact at `openspec/changes/design-points-transaction-system/proposal.md`.
- Split the design into three capabilities:
  - `point-wallet-ledger`
  - `point-action-settlement`
  - `transaction-consistency`

## 2026-06-10 16:12 CST - OpenSpec Design and Specs

- Generated `design.md` for the proposed architecture.
- Defined the key decisions:
  - PostgreSQL as the primary source of truth.
  - Reserve/capture/release lifecycle for fixed 100-point actions.
  - Append-only ledger plus wallet balance projection.
  - Idempotency keys for retry safety.
  - Database-level nested transactions via savepoints.
  - Business-level nested transactions via parent-child transaction records.
  - Outbox events for post-commit side effects.
- Generated three OpenSpec spec files with testable requirements and scenarios:
  - `specs/point-wallet-ledger/spec.md`
  - `specs/point-action-settlement/spec.md`
  - `specs/transaction-consistency/spec.md`

## 2026-06-10 16:14 CST - Task Breakdown and Validation

- Generated `tasks.md` as the checklist for producing the final architecture document and Private Gist deliverable.
- Included tasks for:
  - Final Markdown architecture document.
  - Transaction flow design.
  - Consistency and nested transaction explanation.
  - Production readiness.
  - Verification and delivery.
- Ran OpenSpec verification:
  - `openspec status --change "design-points-transaction-system"`
  - `openspec validate "design-points-transaction-system"`
- Result: all 4 OpenSpec artifacts were complete and the change was valid.

## 2026-06-10 16:16 CST - Manual Judgment Notes

- The final answer should avoid presenting a long-running database transaction around the whole action execution. That would be fragile and unrealistic.
- The final design should explicitly distinguish database nested transactions from business nested transactions.
- The final document should emphasize invariants, idempotency, state transitions, and recovery jobs because these are the strongest backend engineering signals for this assignment.
- Before creating the Private Gist, the final Markdown document should be reviewed against every required section listed in `docs/context.md`.

## 2026-06-10 16:25 CST - Operability Requirement

- Added a non-functional requirement for project operability and handoff.
- Decided not to add a placeholder `docker-compose.yml` while the repository has no runnable backend service.
- Added `AGENTS.md` so a future AI agent or engineer can immediately understand the project state, current OpenSpec change, validation commands, and design direction.
- Added OpenSpec capability `project-operability` to track Docker Compose expectations and AI/engineer handoff documentation as explicit requirements.

## 2026-06-10 16:49 CST - Backend Stack and Type Strategy

- Discussed moving the design toward a concrete backend stack:
  - Node.js with Fastify.
  - PostgreSQL as the primary database.
  - Swagger/OpenAPI docs generated from route schemas.
  - Docker Compose as the expected local setup path once runnable code exists.
- Selected `Kysely + pg` for database access instead of raw `pg` only:
  - Keeps SQL explicit enough for row locks, savepoints, state transitions, and ledger writes.
  - Provides stronger TypeScript inference for table names, columns, selects, inserts, and updates.
  - Avoids ORM behavior that could hide transaction and locking details that are important for this assignment.
- Chose TypeBox for Fastify request/response schemas:
  - Fastify validation and serialization are JSON Schema-based.
  - `@fastify/swagger` can generate API docs from route schemas.
  - `@fastify/type-provider-typebox` gives typed request and response handling without adding a second schema language.
- Surveyed Zod and decided not to use it for the main API schema layer:
  - Zod is viable, and Zod v4 supports JSON Schema conversion.
  - The Fastify Zod type provider is third-party and requires validator, serializer, and Swagger transform setup.
  - Some Zod constructs are not cleanly representable as JSON Schema, which can complicate OpenAPI generation.
  - For this project, TypeBox is simpler because the API contract is JSON-oriented and should be documentation-friendly.
- Reviewed `kysely-codegen` side effects and repository policy:
  - `kysely-codegen` introspects a live database schema and writes generated TypeScript database types.
  - Codegen requires the database and migrations to be available, so generated types should not be the only way to typecheck the project.
  - The generated DB type file should be committed to git, not ignored, because the project has an explicit handoff and easy-setup requirement.
  - Schema migrations and generated types must be updated together.
  - CI should run `kysely-codegen --verify` to detect drift between migrations/database schema and committed generated types.
- Tentative codegen convention:
  - Store generated types at `src/db/generated.ts` or `src/db/generated.d.ts`.
  - Commit `.kysely-codegenrc.json`.
  - Do not manually edit the generated type file.
  - Keep `.env`, local database data, and build artifacts ignored.

## 2026-06-10 16:56 CST - Implementation Planning

- Created a development plan from the accepted OpenSpec requirements at `docs/plans/2026-06-10-points-management-backend-implementation.md`.
- Planned implementation around the confirmed stack:
  - Node.js 22 LTS.
  - Fastify 5.
  - TypeBox route schemas.
  - Kysely + pg.
  - PostgreSQL.
  - `kysely-codegen` with generated database types committed to git.
  - Docker Compose for local setup.
- Broke the implementation into task-sized phases:
  - project scaffold
  - Docker Compose setup
  - configuration and errors
  - database schema, migrations, and codegen
  - transaction/savepoint helpers
  - repositories
  - idempotency
  - recharge
  - reserve/capture/release
  - concurrency tests
  - business nested transactions
  - recovery and reconciliation
  - API routes and Swagger docs
  - architecture documentation
  - final verification
- Added a requirement coverage checklist mapping implementation tasks back to OpenSpec capabilities.

## 2026-06-10 17:10 CST - Scaffold and Local Setup Implementation

- Started implementation directly in the repository working tree so code changes are easy to review.
- Implemented the first runnable Fastify scaffold:
  - `package.json`
  - `tsconfig.json`
  - `.env.example`
  - `.gitignore`
  - `src/app.ts`
  - `src/server.ts`
  - `test/http/health.test.ts`
- Followed TDD for the health route:
  - Wrote `test/http/health.test.ts` first.
  - Confirmed it failed because `src/app.ts` did not exist.
  - Added the minimal Fastify app and verified the test passed.
- Added Docker local setup in the same implementation batch to satisfy the operability requirement:
  - `Dockerfile`
  - `docker-compose.yml`
  - `README.md`
- Updated `AGENTS.md` to reflect that implementation is now in progress and the repository has a runnable Fastify scaffold.
- Verification completed:
  - `npm test`
  - `npm run build`
  - `openspec validate "design-points-transaction-system"`
  - `git diff --check`
- Docker Compose runtime verification could not run in this environment because the WSL distro does not have the `docker` command available.

## 2026-06-10 17:12 CST - Scaffold Review Fixes

- Addressed code review feedback after the initial scaffold/local setup commit:
  - Added `tsconfig.test.json` and `npm run typecheck` so test files are typechecked without emitting them into `dist`.
  - Added `.dockerignore` to keep `.git`, `.env`, `node_modules`, `dist`, local database data, docs, and OpenSpec files out of Docker build context.
  - Updated the health route test to close the Fastify instance after injection.
  - Split README local setup into Docker and host Node.js paths so Docker remains a true one-command startup path after copying `.env.example`.

## 2026-06-10 17:21 CST - Configuration and Error Handling

- Implemented Task 3 from the development plan.
- Followed TDD:
  - Added `test/config/env.test.ts` and `test/plugins/error-handler.test.ts` first.
  - Confirmed they failed because `src/config/env.ts` and `src/plugins/error-handler.ts` did not exist.
  - Added the minimal env loader, shared application error classes, and Fastify error handler plugin.
- Integrated the error handler plugin into `buildApp`.
- Updated `src/server.ts` to read host and port from `loadEnv`.
- Verification completed:
  - `npm test -- test/config/env.test.ts test/plugins/error-handler.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
  - `openspec validate "design-points-transaction-system"`

## 2026-06-10 17:29 CST - Configuration Review Fixes

- Addressed code review feedback for Task 3:
  - Fastify validation errors now return `400 VALIDATION_ERROR` instead of being hidden as `500 INTERNAL_SERVER_ERROR`.
  - `loadEnv` now rejects invalid `NODE_ENV` and invalid `LOG_LEVEL` values.
  - `src/server.ts` now parses environment config before constructing the Fastify app.
  - `buildApp` now receives the logger level explicitly instead of reading raw `process.env.LOG_LEVEL`.
- Added regression tests for invalid env values, Fastify validation errors, and explicit app logger configuration.
- Verification completed:
  - `npm test -- test/config/env.test.ts test/plugins/error-handler.test.ts test/app.test.ts`
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - `openspec validate "design-points-transaction-system"`
  - `git diff --check`

## 2026-06-10 18:14 CST - Database Scaffold with Docker-only DB Verification

- Continued Task 4 with the explicit constraint that database verification must run through Docker, not local `psql`, `postgres`, or `initdb`.
- Confirmed Docker is still unavailable in the current WSL environment:
  - `docker version` reports Docker Desktop WSL integration is not active.
  - Direct Windows Docker binary invocation fails with a WSL vsock socket error.
- Implemented database scaffold that can be statically verified without connecting to a local database:
  - `.kysely-codegenrc.json`
  - `src/db/database.ts`
  - `src/db/migrate.ts`
  - `src/db/migrations/202606100001_initial_schema.ts`
  - `src/db/generated.ts`
  - `test/db/db-scaffold.test.ts`
- Added a temporary committed `src/db/generated.ts` matching the initial migration so the repository can typecheck before Docker is available.
- Updated Docker setup so migration and codegen can run inside the Compose app container once Docker is available:
  - `Dockerfile` now has a dev target with dev dependencies.
  - `docker-compose.yml` uses the dev target and bind mounts the repository so generated types write back to the host.
  - `README.md` and `AGENTS.md` document Docker-only DB migration/codegen commands.
- Deferred runtime migration and `kysely-codegen --verify` validation until Docker is available.

## 2026-06-10 18:21 CST - Database Scaffold Spec Review Fix

- Addressed Task 4 spec review feedback:
  - Updated `docs/plans/2026-06-10-points-management-backend-implementation.md` so migration, type generation, and type drift checks use `docker compose run --rm app ...` instead of host-side `DATABASE_URL=... npm run ...` or direct host `npm run db:*` commands.
  - Kept the Docker-only DB verification constraint explicit for future agents.
- Runtime migration and `kysely-codegen --verify` remain deferred until Docker is available in the local environment.

## 2026-06-10 18:35 CST - Database Scaffold Code Review Fixes

- Addressed Task 4 code quality review feedback:
  - Replaced `text` plus check constraints with PostgreSQL enum types for point operation/status, ledger entry type, and outbox status so future `kysely-codegen` output can preserve string union types.
  - Added indexes for expired reservation recovery, parent-child transaction lookup, and outbox polling.
  - Updated the bootstrap `src/db/generated.ts` type aliases to align with PostgreSQL enum codegen naming.
  - Updated the implementation plan to document the temporary Docker-deferred generated type exception and the actual DB scaffold test file name.
- Added scaffold tests that catch enum/typegen drift and missing planned workflow indexes without requiring local PostgreSQL access.
