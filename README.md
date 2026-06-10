# Points Management Backend

Backend service for a transactional point management assignment.

The implemented stack is Fastify + PostgreSQL + Kysely + Swagger/OpenAPI.

## 專案概述

這是一個交易一致性導向的點數管理後端。系統不是只維護單一餘額欄位，而是同時維護可用點數、保留點數、交易狀態、不可變動的 ledger 紀錄，以及 outbox 事件，讓充值、扣點、失敗退款、重試與併發請求都能被明確追蹤。

主要功能：

- **錢包餘額投影**：每個使用者有一個 wallet，包含 `available_points` 與 `held_points`。
- **點數充值**：`POST /wallets/recharge` 會增加可用點數，建立 `RECHARGED` point transaction，寫入 ledger 與 outbox。
- **固定 100 點操作成本**：action reserve 固定保留 100 點，從可用點數移到保留點數。
- **操作成功扣點**：capture 會將保留點數正式扣除，交易狀態轉為 `CAPTURED`。
- **操作失敗退款**：release 會將保留點數退回可用點數，交易狀態轉為 `RELEASED`。
- **Idempotency**：充值與 reserve 支援 idempotency key；相同 request retry 會回傳既有結果，不會重複加點或扣點。
- **Request hashing**：相同 idempotency key 若搭配不同 payload，會回傳 conflict，避免 key 被誤用。
- **交易一致性**：wallet、point transaction、ledger、outbox 會在同一個 PostgreSQL transaction 中提交或一起 rollback。
- **併發控制**：以 row-level lock 保護 wallet，避免同一筆點數被兩個 concurrent reserve 重複消耗。
- **Nested transaction**：資料庫層使用 PostgreSQL `SAVEPOINT`；業務層使用 parent-child point transaction 表達父子工作流。
- **逾期保留回收**：expired `RESERVED` transaction 可以透過 recovery service 自動 release。
- **Ledger reconciliation**：可用 ledger delta 加總比對 wallet projection，偵測餘額漂移。
- **Swagger 文件**：啟動服務後可透過 `/docs` 查看 OpenAPI 文件。

## 驗證指南

完整手動驗證流程請見：

- [docs/verification.zh-TW.md](docs/verification.zh-TW.md)

Gist 交付入口請見：

- [docs/gist/README.md](docs/gist/README.md)

建議至少跑過：

```bash
docker compose down -v
docker compose up -d --build
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm test
```

## 開發紀錄

如果想看這個專案是怎麼一步一步做出來的，可以看：

- [docs/work-log.md](docs/work-log.md)

簡單說，我一開始先把 `docs/context.md` 當成收到的題目來拆需求，接著用 OpenSpec 把點數管理、nested transaction、idempotency、Docker 易架設這些需求整理清楚。技術選擇上決定用 Node.js + Fastify + PostgreSQL + Kysely，先把 migration、codegen、repository、transaction/savepoint 這些底層打穩，再往上做充值、reserve/capture/release、併發測試、父子交易、逾期回收、reconciliation，最後才接 API routes 和 Swagger。

後面 work-log 也記錄了幾個比較重要的討論點：為什麼 idempotency key 需要搭配 request hash、nested transaction 要分成資料庫層 savepoint 和業務層 parent-child transaction、測試為什麼要透過 Docker 跑 PostgreSQL，以及最後怎麼用 clean Docker Compose 環境把整個流程驗證過一次。

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
