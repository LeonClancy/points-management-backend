import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists "pgcrypto"`.execute(db);
  await sql`
    do $$
    begin
      create type point_operation as enum ('RECHARGE', 'ACTION');
    exception
      when duplicate_object then null;
    end $$;
  `.execute(db);
  await sql`
    do $$
    begin
      create type point_transaction_status as enum (
        'RECHARGED',
        'RESERVED',
        'CAPTURED',
        'RELEASED',
        'FAILED'
      );
    exception
      when duplicate_object then null;
    end $$;
  `.execute(db);
  await sql`
    do $$
    begin
      create type ledger_entry_type as enum (
        'RECHARGE',
        'RESERVE',
        'CAPTURE',
        'RELEASE',
        'ADJUSTMENT'
      );
    exception
      when duplicate_object then null;
    end $$;
  `.execute(db);
  await sql`
    do $$
    begin
      create type outbox_status as enum ('PENDING', 'PUBLISHED', 'FAILED');
    exception
      when duplicate_object then null;
    end $$;
  `.execute(db);

  await db.schema
    .createTable('wallets')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().unique())
    .addColumn('available_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('held_points', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('wallets_available_points_non_negative', sql`available_points >= 0`)
    .addCheckConstraint('wallets_held_points_non_negative', sql`held_points >= 0`)
    .execute();

  await db.schema
    .createTable('point_transactions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('wallet_id', 'uuid', (col) => col.notNull().references('wallets.id'))
    .addColumn('parent_transaction_id', 'uuid', (col) =>
      col.references('point_transactions.id')
    )
    .addColumn('operation', sql`point_operation`, (col) => col.notNull())
    .addColumn('status', sql`point_transaction_status`, (col) => col.notNull())
    .addColumn('amount', 'integer', (col) => col.notNull())
    .addColumn('idempotency_scope', 'text', (col) => col.notNull())
    .addColumn('idempotency_key', 'text', (col) => col.notNull())
    .addColumn('request_hash', 'text', (col) => col.notNull())
    .addColumn('response_payload', 'jsonb')
    .addColumn('expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('point_transactions_amount_positive', sql`amount > 0`)
    .execute();

  await db.schema
    .createIndex('point_transactions_idempotency_unique')
    .on('point_transactions')
    .columns(['idempotency_scope', 'idempotency_key'])
    .unique()
    .execute();

  await db.schema
    .createIndex('point_transactions_wallet_status_idx')
    .on('point_transactions')
    .columns(['wallet_id', 'status'])
    .execute();

  await db.schema
    .createIndex('point_transactions_expired_reservations_idx')
    .on('point_transactions')
    .columns(['status', 'expires_at'])
    .where('status', '=', 'RESERVED')
    .where('expires_at', 'is not', null)
    .execute();

  await db.schema
    .createIndex('point_transactions_parent_status_idx')
    .on('point_transactions')
    .columns(['parent_transaction_id', 'status'])
    .where('parent_transaction_id', 'is not', null)
    .execute();

  await db.schema
    .createTable('point_ledger_entries')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('wallet_id', 'uuid', (col) => col.notNull().references('wallets.id'))
    .addColumn('transaction_id', 'uuid', (col) =>
      col.notNull().references('point_transactions.id')
    )
    .addColumn('entry_type', sql`ledger_entry_type`, (col) => col.notNull())
    .addColumn('available_delta', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('held_delta', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('point_ledger_entries_wallet_idx')
    .on('point_ledger_entries')
    .columns(['wallet_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('outbox_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('aggregate_type', 'text', (col) => col.notNull())
    .addColumn('aggregate_id', 'uuid', (col) => col.notNull())
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('status', sql`outbox_status`, (col) =>
      col.notNull().defaultTo(sql`'PENDING'::outbox_status`)
    )
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('available_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('published_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('outbox_events_attempts_non_negative', sql`attempts >= 0`)
    .execute();

  await db.schema
    .createIndex('outbox_events_available_idx')
    .on('outbox_events')
    .columns(['status', 'available_at'])
    .where('status', '=', 'PENDING')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('outbox_events').ifExists().execute();
  await db.schema.dropTable('point_ledger_entries').ifExists().execute();
  await db.schema.dropTable('point_transactions').ifExists().execute();
  await db.schema.dropTable('wallets').ifExists().execute();
  await sql`drop type if exists outbox_status`.execute(db);
  await sql`drop type if exists ledger_entry_type`.execute(db);
  await sql`drop type if exists point_transaction_status`.execute(db);
  await sql`drop type if exists point_operation`.execute(db);
}
