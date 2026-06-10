import type { ColumnType } from 'kysely';

// Bootstrap DB types matching the initial migration.
// Regenerate this file with `docker compose run --rm app npm run db:generate-types`
// after Docker/PostgreSQL is available, then verify it with
// `docker compose run --rm app npm run db:check-types`.
export type Generated<T> = T extends ColumnType<infer Select, infer Insert, infer Update>
  ? ColumnType<Select, Insert | undefined, Update>
  : ColumnType<T, T | undefined, T>;

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type JsonColumn<T extends Json | null> = ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type LedgerEntryType =
  | 'ADJUSTMENT'
  | 'CAPTURE'
  | 'RECHARGE'
  | 'RELEASE'
  | 'RESERVE';
export type OutboxStatus = 'FAILED' | 'PENDING' | 'PUBLISHED';
export type PointOperation = 'ACTION' | 'RECHARGE';
export type PointTransactionStatus =
  | 'CAPTURED'
  | 'FAILED'
  | 'RECHARGED'
  | 'RELEASED'
  | 'RESERVED';

export interface Wallets {
  id: Generated<string>;
  user_id: string;
  available_points: Generated<number>;
  held_points: Generated<number>;
  version: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface PointTransactions {
  id: Generated<string>;
  wallet_id: string;
  parent_transaction_id: string | null;
  operation: PointOperation;
  status: PointTransactionStatus;
  amount: number;
  idempotency_scope: string;
  idempotency_key: string;
  request_hash: string;
  response_payload: JsonColumn<Json | null>;
  expires_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface PointLedgerEntries {
  id: Generated<string>;
  wallet_id: string;
  transaction_id: string;
  entry_type: LedgerEntryType;
  available_delta: Generated<number>;
  held_delta: Generated<number>;
  created_at: Generated<Timestamp>;
}

export interface OutboxEvents {
  id: Generated<string>;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: JsonColumn<Json>;
  status: Generated<OutboxStatus>;
  attempts: Generated<number>;
  available_at: Generated<Timestamp>;
  published_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface DB {
  outbox_events: OutboxEvents;
  point_ledger_entries: PointLedgerEntries;
  point_transactions: PointTransactions;
  wallets: Wallets;
}
