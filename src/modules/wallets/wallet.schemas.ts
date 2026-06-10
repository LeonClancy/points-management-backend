import { Type } from '@sinclair/typebox';

export const UserIdParamsSchema = Type.Object({
  user_id: Type.String({ minLength: 1 })
});

export const RechargeRequestSchema = Type.Object({
  user_id: Type.String({ minLength: 1 }),
  amount: Type.Integer({ minimum: 1 }),
  idempotency_key: Type.String({ minLength: 1 })
});

export const RechargeResponseSchema = Type.Object({
  transaction_id: Type.String(),
  wallet_id: Type.String(),
  user_id: Type.String(),
  amount: Type.Integer(),
  available_points: Type.Integer(),
  held_points: Type.Integer(),
  status: Type.Literal('RECHARGED')
});

export const WalletResponseSchema = Type.Object({
  wallet_id: Type.String(),
  user_id: Type.String(),
  available_points: Type.Integer(),
  held_points: Type.Integer(),
  version: Type.Integer()
});
