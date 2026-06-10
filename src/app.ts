import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { errorHandlerPlugin } from './plugins/error-handler.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info'
    }
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(errorHandlerPlugin);

  app.get('/health', async () => ({ status: 'ok' as const }));

  return app;
}
