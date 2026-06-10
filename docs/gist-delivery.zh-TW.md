# Points Management Backend 交付說明

這份文件記錄 Gist 交付方式。實際建立 Gist 時，建議使用 `docs/gist/README.md` 當作 Gist 入口，因為它使用 GitHub repository 的絕對連結，不會因為 Gist 裡沒有 `docs/` 目錄而讓 Markdown 相對連結失效。

## Repository

- Repository: https://github.com/LeonClancy/points-management-backend
- Delivery commit: `ece94c9 docs: add Chinese verification guide`
- Stack: Node.js + Fastify + PostgreSQL + Kysely + pg + TypeBox + Swagger/OpenAPI

## 專案目標

這個專案實作一個交易一致性導向的點數管理後端。重點不是只做一個餘額欄位，而是把點數異動、交易狀態、ledger、outbox、idempotency、併發控制和 recovery 都放進設計裡，讓充值、扣點、退款和 retry 行為可以被追蹤，也能在錯誤情境下維持一致。

## 已完成功能

- 使用者 wallet，包含 `available_points` 與 `held_points`。
- `POST /wallets/recharge` 充值點數。
- `POST /actions/reserve` 固定保留 100 點作為 action 成本。
- `POST /actions/:transaction_id/capture` 在 action 成功後正式扣除保留點數。
- `POST /actions/:transaction_id/release` 在 action 失敗、取消或回收時退回保留點數。
- Idempotency key 支援充值與 reserve retry，避免重複加點或重複扣點。
- Request hash 檢查同一個 idempotency key 是否被不同 payload 誤用。
- PostgreSQL transaction 包住 wallet、point transaction、ledger、outbox。
- Row-level lock 保護同一個 wallet 的 concurrent reserve。
- PostgreSQL `SAVEPOINT` 支援資料庫層 nested transaction。
- `parent_transaction_id` 支援業務層 parent-child transaction。
- Expired reservation recovery。
- Ledger reconciliation。
- Swagger/OpenAPI 文件，啟動後可看 `/docs`。
- Docker Compose local setup，方便接手者直接啟動。

## 設計摘要

Action 的點數流程採用 reserve/capture/release：

1. 充值會增加 wallet 的 available points。
2. action 開始前先 reserve 100 點，從 available 移到 held。
3. action 成功時 capture，把 held points 正式扣除。
4. action 失敗、取消或逾期時 release，把 held points 退回 available。

Wallet 是查詢用 projection，ledger 是 audit source。所有點數異動都會同時寫入 point transaction、ledger 和 outbox，避免外部系統看到已通知但實際資料 rollback 的狀況。

Nested transaction 分成兩層：

- 資料庫層：用 PostgreSQL `SAVEPOINT`，讓內層失敗可以 rollback 到 savepoint，不一定要讓外層 transaction 失敗。
- 業務層：用 `point_transactions.parent_transaction_id` 表達父子工作流，parent fail 時可以 release 仍在 `RESERVED` 的 child transactions，並保留已 `CAPTURED` 的 child 結果。

## 驗證方式

建議從乾淨 Docker 環境開始：

```bash
docker compose down -v
docker compose up -d --build
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:check-types
docker compose run --rm app npm test
```

這次交付前已跑過：

- `docker compose run --rm app npm test`
- 結果：15 個 test files passed，61 個 tests passed

基本服務檢查：

```bash
curl -sS http://127.0.0.1:3000/health
```

預期：

```json
{"status":"ok"}
```

Swagger UI：

```text
http://127.0.0.1:3000/docs
```

手動 API smoke flow 請看 repository 內的 `docs/verification.zh-TW.md`。

## 建議閱讀順序

1. `README.md`
   - 看專案概述、功能列表、Docker 啟動方式和 API 列表。
2. `docs/architecture.md`
   - 看資料模型、交易流程、一致性、nested transaction、recovery、outbox 和 production readiness。
3. `docs/verification.zh-TW.md`
   - 照著跑 clean Docker setup、自動化測試和手動 API smoke flow。
4. `docs/work-log.md`
   - 看這個專案從需求拆解、OpenSpec、技術選型到實作驗證的過程。

## Gist 建議內容

建議只上傳這份交付入口：

- `docs/gist/README.md`

建立指令：

```bash
gh gist create docs/gist/README.md -d "Points Management Backend delivery"
```

這樣 Gist 裡的入口檔會直接提供：

- repository URL
- delivery commit URL
- branch URL
- README、架構文件、驗證文件、work-log 的 GitHub 絕對連結
- Docker 驗證指令

不建議直接把 repo 內的 `README.md`、`docs/architecture.md`、`docs/verification.zh-TW.md` 和 `docs/work-log.md` 原封不動丟到 Gist，因為這些文件裡的相對連結在 Gist 環境不一定能正確指回 repository。

Gist 建議建立為 `secret gist`。GitHub 的 secret gist 不是權限型 private，只是未列出；知道 URL 的人仍然可以讀取。
