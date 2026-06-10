import type { Json } from '../../db/generated.js';
import type { DbExecutor } from '../../db/transaction.js';

export type TimestampInput = Date | string;

export interface AppendOutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Json;
  availableAt?: TimestampInput;
}

export async function appendOutboxEvent(db: DbExecutor, input: AppendOutboxEventInput) {
  return db
    .insertInto('outbox_events')
    .values({
      aggregate_id: input.aggregateId,
      aggregate_type: input.aggregateType,
      available_at: input.availableAt,
      event_type: input.eventType,
      payload: input.payload
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
