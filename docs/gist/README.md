# Points Management Backend 交付入口

這份 Gist 是點數管理後端作業的交付入口。完整程式碼、Docker 設定、測試與文件都在 GitHub repository；Gist 只放導覽，避免 Markdown 相對連結在 Gist 裡失效。

## 原始碼

- Repository: https://github.com/LeonClancy/points-management-backend
- Code baseline commit: https://github.com/LeonClancy/points-management-backend/commit/ece94c9
- Branch: https://github.com/LeonClancy/points-management-backend/tree/main

## 專案摘要

這是一個交易一致性導向的點數管理後端。系統支援充值、固定 100 點 action reserve、成功 capture 扣點、失敗或逾期 release 退款，並且處理 idempotency、request hash、row-level lock、ledger audit、outbox、nested transaction、expired reservation recovery 與 reconciliation。

技術棧：

- Node.js
- Fastify
- PostgreSQL
- Kysely + pg
- TypeBox
- Swagger/OpenAPI
- Docker Compose

## 已完成重點

- Wallet projection：`available_points` 與 `held_points`。
- Recharge：增加可用點數，建立交易、ledger 與 outbox。
- Reserve：action 開始前固定保留 100 點。
- Capture：action 成功後正式扣除 held points。
- Release：action 失敗、取消或逾期時退回 held points。
- Idempotency：避免 retry 重複加點或重複扣點。
- Request hashing：避免相同 idempotency key 被不同 payload 誤用。
- Transaction consistency：wallet、point transaction、ledger、outbox 同 transaction commit。
- Concurrency control：用 PostgreSQL row-level lock 保護同一個 wallet。
- Nested transaction：DB 層用 `SAVEPOINT`，業務層用 parent-child point transaction。
- Recovery：釋放逾期仍在 `RESERVED` 狀態的 reservation。
- Reconciliation：用 ledger delta 比對 wallet projection。
- API docs：服務啟動後可看 `/docs`。

## 推薦閱讀

- 專案 README：
  https://github.com/LeonClancy/points-management-backend/blob/main/README.md
- 架構設計：
  https://github.com/LeonClancy/points-management-backend/blob/main/docs/architecture.md
- 中文驗證流程：
  https://github.com/LeonClancy/points-management-backend/blob/main/docs/verification.zh-TW.md
- 開發紀錄：
  https://github.com/LeonClancy/points-management-backend/blob/main/docs/work-log.md
- 題目原文：
  https://github.com/LeonClancy/points-management-backend/blob/main/docs/context.md

## 驗證方式

建議從乾淨 Docker 環境開始：

```bash
git clone git@github.com:LeonClancy/points-management-backend.git
cd points-management-backend
docker compose down -v
docker compose up -d --build
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:check-types
docker compose run --rm app npm test
```

交付前已驗證：

- `docker compose run --rm app npm test`
- 結果：15 個 test files passed，61 個 tests passed

基本服務檢查：

```bash
curl -sS http://127.0.0.1:3000/health
```

Swagger UI：

```text
http://127.0.0.1:3000/docs
```

完整手動 API smoke flow 請看：

https://github.com/LeonClancy/points-management-backend/blob/main/docs/verification.zh-TW.md

## Gist 建立指令

建議只上傳這個交付入口檔，並在 Gist 裡命名成 `README.md`：

```bash
gh gist create docs/gist/README.md -d "Points Management Backend delivery"
```

`gh gist create` 預設建立 secret gist，不加 `--public` 就不會公開列出。GitHub 的 secret gist 不是權限型 private，只是未列出；知道 URL 的人仍然可以讀取。
