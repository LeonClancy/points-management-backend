import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info'
    }
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.get('/health', async () => ({ status: 'ok' as const }));

  return app;
}
