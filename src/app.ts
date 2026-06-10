import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { LogLevel } from './config/env.js';
import { createDb } from './db/database.js';
import type { DB } from './db/generated.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { actionRoutes } from './modules/actions/action.routes.js';
import { walletRoutes } from './modules/wallets/wallet.routes.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { swaggerPlugin } from './plugins/swagger.js';
import type { Kysely } from 'kysely';

export type BuildAppOptions = {
  databaseUrl?: string;
  db?: Kysely<DB>;
  loggerLevel?: LogLevel;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const ownedDb = options.db ? undefined : options.databaseUrl ? createDb(options.databaseUrl) : undefined;
  const db = options.db ?? ownedDb;
  const app = Fastify({
    logger: {
      level: options.loggerLevel ?? 'info'
    }
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(errorHandlerPlugin);
  await app.register(swaggerPlugin);
  await app.register(healthRoutes);

  if (db) {
    await app.register(walletRoutes, { db });
    await app.register(actionRoutes, { db });
  }

  if (ownedDb) {
    app.addHook('onClose', async () => {
      await ownedDb.destroy();
    });
  }

  return app;
}
