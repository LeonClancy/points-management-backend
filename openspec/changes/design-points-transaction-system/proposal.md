## Why

The assignment asks for a backend design for a point system that can safely handle recharge, point deduction, failure refunds, nested transactions, and production-grade consistency concerns. The design needs to show accounting correctness under retries, concurrent actions, and partial failures rather than only describing basic balance updates.

## What Changes

- Define a point wallet model that separates available points from reserved points.
- Define append-only ledger entries so every balance movement is auditable and reconcilable.
- Define an action lifecycle where each action first reserves 100 points, then either captures the reservation on success or releases it on failure.
- Define idempotent transaction APIs to make client retries and worker retries safe.
- Define nested transaction behavior using database savepoints plus business-level parent-child transaction records.
- Define consistency, error handling, reconciliation, and production readiness requirements for a formal backend design document.

## Capabilities

### New Capabilities

- `point-wallet-ledger`: Wallet balance storage, recharge behavior, immutable ledger entries, and balance reconciliation.
- `point-action-settlement`: Reservation, capture, and release flows for actions that cost a fixed 100 points.
- `transaction-consistency`: Transaction boundaries, nested transaction behavior, concurrency control, idempotency, and recovery rules.

### Modified Capabilities

None.

## Impact

- Backend domain model for wallets, business transactions, ledger entries, and outbox events.
- Database selection and schema design, with PostgreSQL as the recommended primary database.
- Transaction manager behavior, including `SELECT ... FOR UPDATE`, unique idempotency keys, valid state transitions, and `SAVEPOINT` support.
- Operational design for retries, stale reservation recovery, reconciliation, monitoring, auditability, and future scaling.
