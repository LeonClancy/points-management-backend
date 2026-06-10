import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandlerPlugin } from '../../src/plugins/error-handler.js';
import { AppError } from '../../src/shared/errors.js';

describe('errorHandlerPlugin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serializes application errors', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    const app = Fastify({ logger: { level: 'silent' } });

    await app.register(errorHandlerPlugin);
    app.get('/boom', async () => {
      throw new AppError('Conflict happened', 409, 'CONFLICT');
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/boom' });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: {
          code: 'CONFLICT',
          message: 'Conflict happened'
        }
      });
    } finally {
      await app.close();
    }
  });

  it('hides unexpected error details', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    const app = Fastify({ logger: { level: 'silent' } });

    await app.register(errorHandlerPlugin);
    app.get('/boom', async () => {
      throw new Error('database password is secret');
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/boom' });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unexpected server error'
        }
      });
    } finally {
      await app.close();
    }
  });

  it('serializes Fastify validation errors as client errors', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    const app = Fastify({ logger: { level: 'silent' } });

    await app.register(errorHandlerPlugin);
    app.post(
      '/body',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' }
            }
          }
        }
      },
      async () => ({ ok: true })
    );

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/body',
        payload: {}
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed'
        }
      });
    } finally {
      await app.close();
    }
  });
});
