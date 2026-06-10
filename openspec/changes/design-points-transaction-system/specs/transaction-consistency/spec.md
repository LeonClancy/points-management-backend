## ADDED Requirements

### Requirement: Point mutations are atomic
The system SHALL persist wallet updates, transaction state changes, ledger entries, and outbox events for a point operation in one database transaction.

#### Scenario: Operation commits
- **WHEN** a point operation completes all required writes successfully
- **THEN** the wallet, point transaction, ledger entries, and outbox event MUST become visible together after commit

#### Scenario: Operation rolls back
- **WHEN** any required write in a point operation fails
- **THEN** the system MUST roll back all writes from that operation

### Requirement: Concurrent wallet operations are serialized
The system SHALL protect each wallet from concurrent overspending.

#### Scenario: Two actions compete for the same points
- **WHEN** two action reserve requests concurrently try to reserve the same available points
- **THEN** the system MUST serialize updates to the wallet row so that at most one request can spend each point

#### Scenario: Concurrent request sees updated balance
- **WHEN** a reserve request waits for another wallet mutation to commit
- **THEN** it MUST evaluate the available balance after the prior mutation is committed

### Requirement: Idempotency prevents duplicate effects
The system SHALL require idempotency keys for externally retried point operations.

#### Scenario: Same idempotency key is reused
- **WHEN** a client or worker retries an operation with the same idempotency key and operation scope
- **THEN** the system MUST return the stored result without creating duplicate wallet or ledger changes

#### Scenario: Same key has conflicting payload
- **WHEN** a retry uses an existing idempotency key with a different operation payload
- **THEN** the system MUST reject the request as an idempotency conflict

### Requirement: Database nested transactions use savepoints
The system SHALL implement nested database transaction behavior with savepoints when a transactional function runs inside an existing transaction.

#### Scenario: Inner transaction fails
- **WHEN** an inner transactional function fails after creating a savepoint
- **THEN** the system MUST roll back to that savepoint without committing the inner writes

#### Scenario: Outer transaction fails after inner success
- **WHEN** an inner transactional function succeeds but the outer transaction later fails
- **THEN** the system MUST roll back both outer writes and inner writes

### Requirement: Business nested transactions are traceable
The system SHALL support parent-child point transactions for multi-step business workflows.

#### Scenario: Child transaction belongs to parent workflow
- **WHEN** a workflow starts multiple point-affecting child operations
- **THEN** each child point transaction MUST store the parent transaction identifier

#### Scenario: Parent workflow fails with reserved children
- **WHEN** a parent workflow fails while child transactions are still `RESERVED`
- **THEN** the system MUST release the still-reserved child transactions idempotently before marking the parent failed

### Requirement: Side effects are published after commit
The system SHALL use the outbox pattern for external side effects related to point operations.

#### Scenario: Point operation writes an event
- **WHEN** a point operation needs to notify another system
- **THEN** the system MUST write an outbox event in the same database transaction as the point mutation

#### Scenario: Point operation rolls back
- **WHEN** a point operation rolls back
- **THEN** no outbox event from that operation MUST be published
