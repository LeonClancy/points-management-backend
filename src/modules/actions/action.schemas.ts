import { Type } from '@sinclair/typebox';

export const ReserveActionRequestSchema = Type.Object({
  user_id: Type.String({ minLength: 1 }),
  action_id: Type.String({ minLength: 1 }),
  idempotency_key: Type.String({ minLength: 1 }),
  parent_transaction_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  expires_at: Type.Optional(Type.Union([Type.String(), Type.Null()]))
});

export const TransactionIdParamsSchema = Type.Object({
  transaction_id: Type.String({ minLength: 1 })
});

export const ActionSettlementResponseSchema = Type.Object({
  transaction_id: Type.String(),
  wallet_id: Type.String(),
  user_id: Type.String(),
  action_id: Type.String(),
  parent_transaction_id: Type.Union([Type.String(), Type.Null()]),
  amount: Type.Integer(),
  available_points: Type.Integer(),
  held_points: Type.Integer(),
  status: Type.Union([
    Type.Literal('RESERVED'),
    Type.Literal('CAPTURED'),
    Type.Literal('RELEASED')
  ]),
  expires_at: Type.Union([Type.String(), Type.Null()])
});
