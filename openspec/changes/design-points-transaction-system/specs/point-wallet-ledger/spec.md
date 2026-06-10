## ADDED Requirements

### Requirement: Wallet balance projection
The system SHALL maintain one wallet balance projection per user with separate `available_points` and `held_points` values.

#### Scenario: Wallet is created for first recharge
- **WHEN** a user receives their first successful recharge
- **THEN** the system MUST create or update the user's wallet with the recharged amount added to `available_points`

#### Scenario: Wallet balance cannot be negative
- **WHEN** any point operation would make `available_points` or `held_points` negative
- **THEN** the system MUST reject the operation and persist no wallet or ledger changes from that operation

### Requirement: Recharge records point credit
The system SHALL support user recharge by crediting available points through an idempotent point transaction.

#### Scenario: Successful recharge
- **WHEN** a recharge request with a new idempotency key is accepted
- **THEN** the system MUST increase `available_points`, create a completed recharge transaction, and append a ledger entry for the credit

#### Scenario: Repeated recharge request
- **WHEN** the same recharge request is retried with the same idempotency key
- **THEN** the system MUST return the existing recharge result without creating another ledger entry or increasing points again

### Requirement: Append-only ledger
The system SHALL record every point movement as an append-only ledger entry.

#### Scenario: Point balance changes
- **WHEN** recharge, reserve, capture, or release changes wallet balances
- **THEN** the system MUST append ledger entries that describe the operation type, amount, wallet, related transaction, and resulting accounting direction

#### Scenario: Existing ledger correction
- **WHEN** a previously recorded point movement needs correction
- **THEN** the system MUST create a compensating ledger entry instead of editing or deleting the original ledger entry

### Requirement: Balance reconciliation
The system SHALL support reconciliation between wallet balance projections and ledger entries.

#### Scenario: Reconciliation succeeds
- **WHEN** reconciliation calculates ledger-derived balances for a wallet
- **THEN** the calculated balances MUST match the wallet projection for `available_points` and `held_points`

#### Scenario: Reconciliation detects drift
- **WHEN** ledger-derived balances do not match the wallet projection
- **THEN** the system MUST report the wallet as inconsistent for investigation before further automated correction
