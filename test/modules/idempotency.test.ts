import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/shared/errors.js';
import {
  assertSameRequestHash,
  hashPayload
} from '../../src/modules/points/idempotency.js';

describe('idempotency payload hashing', () => {
  it('produces the same hash for the same JSON payload', () => {
    const payload = {
      amount: 100,
      metadata: {
        source: 'test',
        tags: ['recharge', 'manual']
      },
      userId: 'user-1'
    };

    expect(hashPayload(payload)).toBe(hashPayload(payload));
  });

  it('does not change when object keys are ordered differently', () => {
    const first = {
      amount: 100,
      metadata: {
        source: 'test',
        tags: ['recharge', 'manual']
      },
      userId: 'user-1'
    };
    const second = {
      userId: 'user-1',
      metadata: {
        tags: ['recharge', 'manual'],
        source: 'test'
      },
      amount: 100
    };

    expect(hashPayload(first)).toBe(hashPayload(second));
  });

  it('changes when amount or user id changes', () => {
    const base = hashPayload({ amount: 100, userId: 'user-1' });

    expect(hashPayload({ amount: 200, userId: 'user-1' })).not.toBe(base);
    expect(hashPayload({ amount: 100, userId: 'user-2' })).not.toBe(base);
  });

  it('allows matching hashes for an idempotent retry', () => {
    const hash = hashPayload({ amount: 100, userId: 'user-1' });

    expect(() => assertSameRequestHash(hash, hash)).not.toThrow();
  });

  it('rejects a reused idempotency key with a different request hash', () => {
    const existing = hashPayload({ amount: 100, userId: 'user-1' });
    const incoming = hashPayload({ amount: 200, userId: 'user-1' });

    expect(() => assertSameRequestHash(existing, incoming)).toThrow(ConflictError);
    expect(() => assertSameRequestHash(existing, incoming)).toThrow(
      'Idempotency key was reused with a different payload'
    );

    try {
      assertSameRequestHash(existing, incoming);
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).code).toBe('IDEMPOTENCY_CONFLICT');
      expect((error as ConflictError).statusCode).toBe(409);
    }
  });
});
