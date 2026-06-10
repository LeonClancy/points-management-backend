# 驗證流程指南

這份文件用來手動驗證點數管理系統是否能從乾淨環境啟動，並確認充值、保留、結算、退款與 idempotency 行為符合預期。

## 前置需求

- Docker / Docker Compose 可正常執行。
- 專案根目錄已安裝或可使用 container 內的 Node.js dependencies。
- 本機 `3000` 與 `5432` port 沒有被其他服務佔用。

## 1. 從乾淨環境啟動

清除既有 container 與 PostgreSQL volume：

```bash
docker compose down -v
```

重新 build 並啟動 app + PostgreSQL：

```bash
docker compose up -d --build
```

確認 container 狀態：

```bash
docker compose ps
```

預期：

- `db` 狀態為 `healthy`
- `app` 狀態為 `Up`
- `app` 有 publish `0.0.0.0:3000->3000/tcp`

## 2. 初始化資料庫

執行 migration：

```bash
docker compose run --rm app npm run db:migrate
```

檢查 Kysely generated types 是否和資料庫 schema 一致：

```bash
docker compose run --rm app npm run db:check-types
```

## 3. 基本服務檢查

Health check：

```bash
curl -sS http://127.0.0.1:3000/health
```

預期回應：

```json
{"status":"ok"}
```

Swagger UI：

```bash
open http://127.0.0.1:3000/docs
```

如果環境沒有 `open` 指令，直接用瀏覽器開：

```text
http://127.0.0.1:3000/docs
```

## 4. 自動化驗證

執行完整測試：

```bash
docker compose run --rm app npm test
```

預期：

- 所有 test files passed
- 所有 tests passed

執行 TypeScript 與 build 驗證：

```bash
npm run typecheck
npm run build
```

執行 OpenSpec 驗證：

```bash
openspec validate "design-points-transaction-system"
```

預期：

```text
Change 'design-points-transaction-system' is valid
```

## 5. 手動 API Smoke Flow

以下範例使用固定 user id：

```text
00000000-0000-4000-8000-000000000001
```

### 5.1 充值 200 點

```bash
curl -sS -X POST http://127.0.0.1:3000/wallets/recharge \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","amount":200,"idempotency_key":"manual-recharge-1"}'
```

預期重點：

```json
{
  "amount": 200,
  "available_points": 200,
  "held_points": 0,
  "status": "RECHARGED"
}
```

記下回應中的 `transaction_id`。下一步會驗證 retry 是否回傳同一筆交易。

### 5.2 重試同一筆充值

重跑同一個 curl：

```bash
curl -sS -X POST http://127.0.0.1:3000/wallets/recharge \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","amount":200,"idempotency_key":"manual-recharge-1"}'
```

預期：

- `transaction_id` 和第一次充值相同。
- `available_points` 仍是 `200`。
- 不會變成 `400`。

### 5.3 查詢 wallet

```bash
curl -sS http://127.0.0.1:3000/wallets/00000000-0000-4000-8000-000000000001
```

預期重點：

```json
{
  "available_points": 200,
  "held_points": 0
}
```

### 5.4 Reserve 一個 action

```bash
curl -sS -X POST http://127.0.0.1:3000/actions/reserve \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","action_id":"manual-action-1","idempotency_key":"manual-reserve-1"}'
```

預期重點：

```json
{
  "action_id": "manual-action-1",
  "amount": 100,
  "available_points": 100,
  "held_points": 100,
  "status": "RESERVED"
}
```

記下這次回應的 `transaction_id`，下面用 `<transaction_id>` 代替。

### 5.5 重試同一筆 reserve

重跑同一個 reserve curl：

```bash
curl -sS -X POST http://127.0.0.1:3000/actions/reserve \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","action_id":"manual-action-1","idempotency_key":"manual-reserve-1"}'
```

預期：

- `transaction_id` 和第一次 reserve 相同。
- `available_points` 仍是 `100`。
- `held_points` 仍是 `100`。
- 不會重複保留第二個 100 點。

## 6. Capture 或 Release 驗證

同一個 reserved transaction 只能選一種終態驗證。

### 6.1 Capture 成功扣點

```bash
curl -sS -X POST http://127.0.0.1:3000/actions/<transaction_id>/capture
```

預期重點：

```json
{
  "available_points": 100,
  "held_points": 0,
  "status": "CAPTURED"
}
```

重跑同一個 capture curl，預期回傳同一個 `transaction_id`，不會重複扣點。

### 6.2 Release 失敗退款

如果還沒有 capture，才執行 release：

```bash
curl -sS -X POST http://127.0.0.1:3000/actions/<transaction_id>/release
```

預期重點：

```json
{
  "available_points": 200,
  "held_points": 0,
  "status": "RELEASED"
}
```

重跑同一個 release curl，預期回傳同一個 `transaction_id`，不會重複退款。

## 7. Conflict 驗證

同一個 idempotency key 搭配不同 payload 應該被拒絕。

```bash
curl -sS -X POST http://127.0.0.1:3000/wallets/recharge \
  -H 'content-type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000001","amount":300,"idempotency_key":"manual-recharge-1"}'
```

預期重點：

```json
{
  "error": {
    "code": "IDEMPOTENCY_CONFLICT"
  }
}
```

## 8. 常見問題

### Port 被佔用

如果 `3000` 或 `5432` 被佔用，先停止其他服務，或修改 `docker-compose.yml` 的 port mapping。

### App 已啟動但 API 回傳資料表不存在

代表 migration 尚未執行：

```bash
docker compose run --rm app npm run db:migrate
```

### 想重跑完整流程

清空資料並重來：

```bash
docker compose down -v
docker compose up -d --build
docker compose run --rm app npm run db:migrate
```
