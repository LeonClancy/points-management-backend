export type AppEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  DATABASE_URL: string;
  LOG_LEVEL: LogLevel;
  RESERVATION_TTL_SECONDS: number;
};

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

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
    LOG_LEVEL: parseLogLevel(source.LOG_LEVEL),
    RESERVATION_TTL_SECONDS: parsePositiveInteger(
      source.RESERVATION_TTL_SECONDS,
      900,
      'RESERVATION_TTL_SECONDS'
    )
  };
}

function parseNodeEnv(value: string | undefined): AppEnv['NODE_ENV'] {
  if (value === undefined) {
    return 'development';
  }

  if (value === 'production' || value === 'test') {
    return value;
  }

  if (value === 'development') {
    return value;
  }

  throw new Error('NODE_ENV must be development, test, or production');
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined) {
    return 'info';
  }

  if (
    value === 'trace' ||
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'fatal' ||
    value === 'silent'
  ) {
    return value;
  }

  throw new Error('LOG_LEVEL must be trace, debug, info, warn, error, fatal, or silent');
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
