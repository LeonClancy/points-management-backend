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
