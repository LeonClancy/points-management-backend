import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

describe('buildApp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the provided logger level instead of raw process env', async () => {
    vi.stubEnv('LOG_LEVEL', 'not-a-fastify-level');

    const app = await buildApp({ loggerLevel: 'silent' });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
