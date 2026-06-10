# Points Management Backend

Backend service for a transactional point management assignment.

## Local Setup

```bash
cp .env.example .env
npm install
docker compose up --build
```

Health check:

```bash
curl http://localhost:3000/health
```

OpenAPI docs will be available at `/docs` after Swagger is registered.
