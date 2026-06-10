import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import type { DbExecutor } from '../../db/transaction.js';
import { NotFoundError } from '../../shared/errors.js';
import { rechargePoints } from '../points/point.service.js';
import { findWalletByUserId } from './wallet.repository.js';
import {
  RechargeRequestSchema,
  RechargeResponseSchema,
  UserIdParamsSchema,
  WalletResponseSchema
} from './wallet.schemas.js';

interface WalletRoutesOptions {
  db: DbExecutor;
}

type RechargeRequest = Static<typeof RechargeRequestSchema>;
type UserIdParams = Static<typeof UserIdParamsSchema>;

export async function walletRoutes(app: FastifyInstance, options: WalletRoutesOptions) {
  app.post<{ Body: RechargeRequest }>(
    '/wallets/recharge',
    {
      schema: {
        body: RechargeRequestSchema,
        response: {
          200: RechargeResponseSchema
        }
      }
    },
    async (request) => rechargePoints(options.db, request.body)
  );

  app.get<{ Params: UserIdParams }>(
    '/wallets/:user_id',
    {
      schema: {
        params: UserIdParamsSchema,
        response: {
          200: WalletResponseSchema
        }
      }
    },
    async (request) => {
      const wallet = await findWalletByUserId(options.db, request.params.user_id);
      if (!wallet) {
        throw new NotFoundError('Wallet was not found', 'WALLET_NOT_FOUND');
      }

      return {
        wallet_id: wallet.id,
        user_id: wallet.user_id,
        available_points: wallet.available_points,
        held_points: wallet.held_points,
        version: wallet.version
      };
    }
  );
}
