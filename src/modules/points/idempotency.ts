import { createHash } from 'node:crypto';
import { ConflictError } from '../../shared/errors.js';

type JsonLike =
  | string
  | number
  | boolean
  | null
  | JsonLike[]
  | { [key: string]: JsonLike | undefined };

function stableStringifyValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyValue(item)).join(',')}]`;
  }

  const object = value as Record<string, JsonLike | undefined>;
  const entries = Object.entries(object)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringifyValue(entryValue)}`)
    .join(',')}}`;
}

export function stableStringify(payload: unknown): string {
  return stableStringifyValue(payload);
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function assertSameRequestHash(existing: string, incoming: string): void {
  if (existing !== incoming) {
    throw new ConflictError(
      'Idempotency key was reused with a different payload',
      'IDEMPOTENCY_CONFLICT'
    );
  }
}
