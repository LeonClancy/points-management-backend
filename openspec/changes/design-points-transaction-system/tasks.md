## 1. Final Architecture Document

- [ ] 1.1 Create the final Markdown architecture document under `docs/`.
- [ ] 1.2 Write the problem understanding section and explicitly state the point action lifecycle.
- [ ] 1.3 Explain why PostgreSQL is selected and compare it with MySQL, Redis, and pure event sourcing.
- [ ] 1.4 Define the core data model for wallets, point transactions, ledger entries, and outbox events.
- [ ] 1.5 Include table-level constraints, indexes, and idempotency key uniqueness rules.

## 2. Transaction Flow Design

- [ ] 2.1 Document the recharge flow with atomic wallet, transaction, and ledger writes.
- [ ] 2.2 Document the action reserve flow for the fixed 100-point cost.
- [ ] 2.3 Document the capture flow for successful actions.
- [ ] 2.4 Document the release flow for failed, cancelled, or expired actions.
- [ ] 2.5 Document valid transaction state transitions and terminal states.

## 3. Consistency and Nested Transactions

- [ ] 3.1 Document wallet invariants and reconciliation rules.
- [ ] 3.2 Explain concurrency control with row-level locking or optimistic version checks.
- [ ] 3.3 Explain idempotent retry behavior for recharge, reserve, capture, and release.
- [ ] 3.4 Explain database-level nested transactions using PostgreSQL `SAVEPOINT`.
- [ ] 3.5 Explain business-level parent-child transactions and failure propagation.

## 4. Production Readiness

- [ ] 4.1 Document stale reservation recovery and timeout handling.
- [ ] 4.2 Document outbox-based event publishing after commit.
- [ ] 4.3 Document reconciliation jobs, audit requirements, metrics, and alerting.
- [ ] 4.4 Document backup, migration, operational tooling, and scaling trade-offs.
- [ ] 4.5 Document security controls such as authentication, authorization, and rate limiting.

## 5. Verification and Delivery

- [ ] 5.1 Add test case examples for insufficient points, concurrent reserves, retry idempotency, nested rollback, and expired reservations.
- [ ] 5.2 Add an AI collaboration log that records agent-assisted analysis and manual design decisions.
- [ ] 5.3 Validate the OpenSpec change with `openspec validate`.
- [ ] 5.4 Review the final Markdown document against the assignment checklist.
- [ ] 5.5 Create the Private Gist with the final Markdown files and preserve revision history for updates.
