## Context

This repository currently contains the assignment prompt only, so the change is a design artifact rather than a migration from an existing implementation. The system must support point recharge, fixed-cost action execution, final deduction on success, refund on incomplete actions, nested transactions, and production readiness analysis.

The key accounting problem is that an action is not completed at the moment it starts. If the system directly deducts 100 points and later tries to refund, retries and partial failures can double refund or double deduct. If it waits until the action succeeds before deducting, concurrent actions can overspend the same balance. The design therefore treats action start as a reservation of 100 points and action completion as settlement.

## Goals / Non-Goals

**Goals:**

- Guarantee that users cannot spend more than their available points.
- Preserve an auditable append-only history for every point movement.
- Make recharge, reserve, capture, and release operations idempotent.
- Define nested transaction semantics at both database and business levels.
- Define operational controls needed before production launch.
- Produce requirements and tasks that can become the final Markdown architecture answer for the assignment.

**Non-Goals:**

- Implement application code in this change.
- Design a multi-currency wallet or variable action pricing model.
- Build a distributed ledger across multiple databases.
- Cover payment provider integration beyond recording a successful recharge request.

## Decisions

### Use PostgreSQL as the primary database

PostgreSQL is the recommended database because it provides ACID transactions, row-level locks, unique constraints, check constraints, foreign keys, and `SAVEPOINT` support for nested database transactions. These features directly match the assignment's consistency requirements.

Alternatives considered:

- MySQL/InnoDB also supports transactions and row locks, but PostgreSQL has strong constraint support and generally clearer savepoint behavior for this design discussion.
- Redis is useful for counters and fast reservations, but using it as the source of truth would make auditability and recovery harder.
- Event sourcing only could be very robust, but it adds complexity that is unnecessary for the assignment. The selected design keeps an immutable ledger while also maintaining wallet balance columns for efficient reads.

### Model actions as reserve, capture, and release

Each action costs exactly 100 points. On action start, the system reserves points by moving 100 from `available_points` to `held_points`. On success, it captures the reservation by reducing `held_points`. On failure or timeout, it releases the reservation by moving 100 from `held_points` back to `available_points`.

This avoids holding a database transaction open while the action runs. It also prevents overspending because reserved points are no longer available to other actions.

### Keep wallet balances plus an append-only ledger

The wallet row stores `available_points`, `held_points`, and `version` for fast reads and locking. Ledger entries are append-only records for recharge, reserve, capture, and release. The wallet row is the operational projection; the ledger is the audit trail and reconciliation source.

The invariant is:

- `available_points >= 0`
- `held_points >= 0`
- `wallet total = available_points + held_points`
- Wallet balances must reconcile to ledger movements for the wallet.

### Use transaction records for business lifecycle

`point_transactions` records the business operation and its state. Example states include `RECHARGED`, `RESERVED`, `CAPTURED`, `RELEASED`, and `FAILED`. Each operation has an `idempotency_key`; retries with the same key return the existing result instead of creating new point movements.

State transitions are explicit:

- `RESERVED -> CAPTURED`
- `RESERVED -> RELEASED`
- Terminal states cannot move again.

### Support nested transactions with savepoints and parent-child records

There are two meanings of nested transaction in this design:

1. Database nesting: if application code calls a transactional function inside an existing database transaction, the transaction manager creates a `SAVEPOINT`. Inner failure rolls back to the savepoint without aborting unrelated outer work. If there is no outer transaction, the function starts and commits a normal database transaction.
2. Business nesting: `point_transactions.parent_transaction_id` links child operations to a parent workflow. If a child reserve or capture fails, the parent workflow can release all still-reserved child transactions and mark itself failed.

This distinction is important because database nested transactions are short-lived execution boundaries, while business nested transactions describe a multi-step workflow that may outlive one database transaction.

### Use outbox events for production side effects

Any event that must be published after a point movement, such as `points.reserved` or `points.captured`, is written to `outbox_events` in the same database transaction. A worker publishes events after commit. This prevents publishing an event for a transaction that later rolls back.

## Risks / Trade-offs

- Reservation rows can become stale if a worker crashes during action execution -> Add an expiration timestamp and a recovery job that releases expired reservations.
- Wallet balance columns can drift from ledger entries due to bugs -> Add reconciliation jobs and alerts that compare wallet projections with ledger sums.
- Row-level locking can limit throughput for a single hot wallet -> Accept this for correctness first, then consider sharded wallets or queued per-wallet processing if product load requires it.
- Idempotency keys can be mis-scoped -> Scope uniqueness by operation type and external request identifier, and store the original response payload for deterministic retry responses.
- Business nested transactions can be confused with database savepoints -> Document both explicitly and keep APIs named around business intent, such as `reserveActionPoints`, `captureReservation`, and `releaseReservation`.

## Migration Plan

For the assignment, this is a greenfield design. A production implementation would introduce the schema first, then implement recharge, reserve, capture, release, reconciliation, and outbox processing behind tests. If migrating from a simpler balance-only system, the migration would backfill one opening ledger entry per wallet and then enable ledger-only mutations.

Rollback strategy for a real deployment would be to stop new point mutations, reconcile wallet and ledger state, and disable the new action reservation endpoints. Since point mutations are accounting records, already-written ledger entries should be compensated with new entries instead of edited or deleted.

## Open Questions

- Should an action reservation expire after a fixed interval, or should the action service explicitly heartbeat long-running work?
- Should recharge be considered final only after a payment provider settlement event, or is the assignment limited to internal recharge records?
- What audit retention and privacy requirements apply to wallet and transaction history?
