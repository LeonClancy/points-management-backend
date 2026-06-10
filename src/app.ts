import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { LogLevel } from './config/env.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';

export type BuildAppOptions = {
  loggerLevel?: LogLevel;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: options.loggerLevel ?? 'info'
    }
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(errorHandlerPlugin);

  app.get('/health', async () => ({ status: 'ok' as const }));

  return app;
}
