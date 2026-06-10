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

  it('loads valid overrides', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://points:points@localhost:5432/points',
      HOST: '127.0.0.1',
      PORT: '4000',
      LOG_LEVEL: 'debug',
      RESERVATION_TTL_SECONDS: '120'
    });

    expect(env).toMatchObject({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 4000,
      LOG_LEVEL: 'debug',
      RESERVATION_TTL_SECONDS: 120
    });
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow('DATABASE_URL');
  });

  it('rejects invalid positive integer values', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://points:points@localhost:5432/points',
        PORT: '0'
      })
    ).toThrow('PORT must be a positive integer');

    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://points:points@localhost:5432/points',
        RESERVATION_TTL_SECONDS: '-1'
      })
    ).toThrow('RESERVATION_TTL_SECONDS must be a positive integer');
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'prod',
        DATABASE_URL: 'postgres://points:points@localhost:5432/points'
      })
    ).toThrow('NODE_ENV');
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://points:points@localhost:5432/points',
        LOG_LEVEL: 'verbose'
      })
    ).toThrow('LOG_LEVEL');
  });
});
