# Points Management Backend

Backend service for a transactional point management assignment.

## Local Setup

Docker path:

```bash
cp .env.example .env
docker compose up --build
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

OpenAPI docs will be available at `/docs` after Swagger is registered.

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
