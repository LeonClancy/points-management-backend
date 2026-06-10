import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import type { DbExecutor } from '../../db/transaction.js';
import {
  captureReservation,
  releaseReservation,
  reserveActionPoints
} from '../points/point.service.js';
import {
  ActionSettlementResponseSchema,
  ReserveActionRequestSchema,
  TransactionIdParamsSchema
} from './action.schemas.js';

interface ActionRoutesOptions {
  db: DbExecutor;
}

type ReserveActionRequest = Static<typeof ReserveActionRequestSchema>;
type TransactionIdParams = Static<typeof TransactionIdParamsSchema>;

export async function actionRoutes(app: FastifyInstance, options: ActionRoutesOptions) {
  app.post<{ Body: ReserveActionRequest }>(
    '/actions/reserve',
    {
      schema: {
        body: ReserveActionRequestSchema,
        response: {
          200: ActionSettlementResponseSchema
        }
      }
    },
    async (request) => reserveActionPoints(options.db, request.body)
  );

  app.post<{ Params: TransactionIdParams }>(
    '/actions/:transaction_id/capture',
    {
      schema: {
        params: TransactionIdParamsSchema,
        response: {
          200: ActionSettlementResponseSchema
        }
      }
    },
    async (request) =>
      captureReservation(options.db, {
        transaction_id: request.params.transaction_id
      })
  );

  app.post<{ Params: TransactionIdParams }>(
    '/actions/:transaction_id/release',
    {
      schema: {
        params: TransactionIdParamsSchema,
        response: {
          200: ActionSettlementResponseSchema
        }
      }
    },
    async (request) =>
      releaseReservation(options.db, {
        transaction_id: request.params.transaction_id
      })
  );
}
