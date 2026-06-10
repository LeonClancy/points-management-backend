import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

describe('loadEnv', () => {
  it('loads defaults for optional values', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://points:points@localhost:5432/points'
    });

    expect(env.PORT).toBe(3000);
    expect(env.RESERVATION_TTL_SECONDS).toBe(900);
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow('DATABASE_URL');
  });
});
