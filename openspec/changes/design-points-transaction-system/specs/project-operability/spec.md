## ADDED Requirements

### Requirement: Project documents current handoff state
The project SHALL include repository-level handoff documentation for future AI agents and engineers.

#### Scenario: New agent enters the repository
- **WHEN** a new AI agent or engineer starts work in the repository
- **THEN** `AGENTS.md` MUST explain the project purpose, current design-only state, key files, OpenSpec change name, and verification commands

#### Scenario: Project state changes
- **WHEN** implementation files, runtime dependencies, or setup commands are added or changed
- **THEN** the handoff documentation MUST be updated in the same change

### Requirement: Implementation supports one-command local setup
The implemented backend SHALL support local startup through Docker Compose once runnable application code exists.

#### Scenario: Developer starts the project locally
- **WHEN** the backend implementation exists and a developer runs `docker compose up --build`
- **THEN** the application service, PostgreSQL database, and required local dependencies MUST start with documented default configuration

#### Scenario: Setup prerequisites are missing
- **WHEN** Docker Compose startup cannot complete because required configuration is missing
- **THEN** the project MUST document the required environment variables and provide safe local defaults or an example environment file

### Requirement: Setup artifacts are not misleading
The project SHALL avoid placeholder runtime setup files that imply a complete runnable backend before such a backend exists.

#### Scenario: Repository is still design-only
- **WHEN** there is no application service to run
- **THEN** the project MUST document the future Docker Compose requirement without adding a fake compose setup that cannot exercise the point system

#### Scenario: Runtime implementation is introduced
- **WHEN** a real backend service is added
- **THEN** the same change MUST add or update Docker Compose so local setup can run the implemented service and database together
