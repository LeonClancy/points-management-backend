import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = await buildApp({
  databaseUrl: env.DATABASE_URL,
  loggerLevel: env.LOG_LEVEL
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
