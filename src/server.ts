import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const app = await buildApp();

const env = loadEnv();

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
