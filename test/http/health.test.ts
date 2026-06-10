import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('health route', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns ok status', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');

    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
