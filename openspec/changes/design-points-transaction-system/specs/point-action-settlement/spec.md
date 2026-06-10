## ADDED Requirements

### Requirement: Action reserves fixed points before execution
The system SHALL reserve exactly 100 points before an action is allowed to execute.

#### Scenario: Reserve succeeds with sufficient points
- **WHEN** a user starts an action and has at least 100 `available_points`
- **THEN** the system MUST move 100 points from `available_points` to `held_points`, create a `RESERVED` transaction, and append reservation ledger entries

#### Scenario: Reserve fails with insufficient points
- **WHEN** a user starts an action and has fewer than 100 `available_points`
- **THEN** the system MUST reject the action before execution and persist no reservation ledger entries

### Requirement: Action success captures reservation
The system SHALL settle a successful action by capturing the existing 100-point reservation.

#### Scenario: Capture succeeds
- **WHEN** an action completes successfully and its transaction is currently `RESERVED`
- **THEN** the system MUST move the transaction to `CAPTURED`, reduce `held_points` by 100, and append capture ledger entries

#### Scenario: Capture is retried
- **WHEN** capture is retried for a transaction that is already `CAPTURED`
- **THEN** the system MUST return the existing captured result without reducing points again

### Requirement: Action failure releases reservation
The system SHALL return reserved points to the user when an action does not complete.

#### Scenario: Release succeeds
- **WHEN** an action fails or is cancelled and its transaction is currently `RESERVED`
- **THEN** the system MUST move the transaction to `RELEASED`, move 100 points from `held_points` back to `available_points`, and append release ledger entries

#### Scenario: Release is retried
- **WHEN** release is retried for a transaction that is already `RELEASED`
- **THEN** the system MUST return the existing released result without increasing available points again

### Requirement: Reservations expire safely
The system SHALL support recovery for reservations that remain incomplete after their allowed processing window.

#### Scenario: Reservation expires
- **WHEN** a reservation passes its expiration time and remains `RESERVED`
- **THEN** the recovery job MUST release the reservation and record the release as an idempotent transaction update

#### Scenario: Reservation already settled before recovery
- **WHEN** the recovery job examines a reservation that is already `CAPTURED` or `RELEASED`
- **THEN** the recovery job MUST make no point balance changes
