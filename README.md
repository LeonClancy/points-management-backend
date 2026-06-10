# Points Management Backend

Backend service for a transactional point management assignment.

The implemented stack is Fastify + PostgreSQL + Kysely + Swagger/OpenAPI.

## Local Setup

Docker path:

```bash
cp .env.example .env
docker compose up --build
```

Run migrations and verification from the app container:

```bash
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:check-types
docker compose run --rm app npm test
```

Host Node.js path:

```bash
cp .env.example .env
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

OpenAPI docs:

```bash
open http://localhost:3000/docs
```

## API

- `GET /health`
- `POST /wallets/recharge`
- `GET /wallets/:user_id`
- `POST /actions/reserve`
- `POST /actions/:transaction_id/capture`
- `POST /actions/:transaction_id/release`

Manual smoke flow:

```bash
curl -sS -X POST http://localhost:3000/wallets/recharge \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","amount":200,"idempotency_key":"manual-recharge-1"}'

curl -sS -X POST http://localhost:3000/actions/reserve \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","action_id":"manual-action-1","idempotency_key":"manual-reserve-1"}'
```

## Database

Start PostgreSQL through Docker Compose:

```bash
docker compose up -d db
```

Run migrations inside the Docker app container:

```bash
docker compose run --rm app npm run db:migrate
```

Regenerate Kysely database types after schema changes:

```bash
docker compose run --rm app npm run db:generate-types
docker compose run --rm app npm run db:check-types
```

`src/db/generated.ts` is committed so the project can typecheck before a local database is running. Regenerate it whenever migrations change.

## Architecture

See `docs/architecture.md` for the design rationale, transaction flows, consistency rules, and production readiness notes.
