# AGENTS.md

## Project Overview

This repository is currently a design-first submission for a backend engineering assignment. The assignment asks for a transactional point management system that supports recharge, fixed 100-point action cost, successful deduction, failure refund, nested transactions, consistency, and production readiness.

There is no runnable backend implementation yet. The current source of truth is the OpenSpec change and supporting docs.

## Required First Step

Run the Superpowers bootstrap before starting agent work:

```bash
~/.codex/superpowers/.codex/superpowers-codex bootstrap
```

Then follow any applicable skill instructions before changing files.

## Key Files

- `docs/context.md`: Original assignment prompt.
- `docs/work-log.md`: Work log for AI-assisted analysis and manual design decisions.
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

Because the repository is still design-only, do not add a fake `docker-compose.yml` that implies the service is runnable. When real backend code is introduced, add Docker Compose support in the same change so a developer can start the app and PostgreSQL with:

```bash
docker compose up --build
```

That future Compose setup should include:

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
- Run OpenSpec validation before claiming the design artifacts are valid.
