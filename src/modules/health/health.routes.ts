import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: Type.Object({
            status: Type.Literal('ok')
          })
        }
      }
    },
    async () => ({ status: 'ok' as const })
  );
}
