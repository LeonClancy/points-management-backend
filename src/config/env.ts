export type AppEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  DATABASE_URL: string;
  LOG_LEVEL: string;
  RESERVATION_TTL_SECONDS: number;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    NODE_ENV: parseNodeEnv(source.NODE_ENV),
    HOST: source.HOST ?? '0.0.0.0',
    PORT: parsePositiveInteger(source.PORT, 3000, 'PORT'),
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: source.LOG_LEVEL ?? 'info',
    RESERVATION_TTL_SECONDS: parsePositiveInteger(
      source.RESERVATION_TTL_SECONDS,
      900,
      'RESERVATION_TTL_SECONDS'
    )
  };
}

function parseNodeEnv(value: string | undefined): AppEnv['NODE_ENV'] {
  if (value === 'production' || value === 'test') {
    return value;
  }

  return 'development';
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}
