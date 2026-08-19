// src/lib/logger.ts
// Structured logger — replaces 56 console.log/warn/error calls in psyLive4.ts.
//
// Levels:
//   debug — verbose (only in dev, suppressed in production)
//   info  — normal operation (user actions, state changes)
//   warn  — recoverable issues (stream failover, fallback used)
//   error — failures (engine crash, data loss)
//
// In production: only warn+error go to console (less noise).
// In dev: all levels with timestamps.
// All logs also go to local DB for offline analysis (future: /api/logs route).

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isDev = process.env.NODE_ENV === 'development';
const isProd = process.env.NODE_ENV === 'production';

// Minimum level to output to console
const MIN_CONSOLE_LEVEL: LogLevel = isDev ? 'debug' : 'warn';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: '🔍',
  info: 'ℹ',
  warn: '⚠',
  error: '✗',
};

function formatTimestamp(): string {
  return new Date().toISOString().split('T')[1].replace('Z', '');
}

function log(level: LogLevel, tag: string, message: string, data?: any): void {
  const ts = formatTimestamp();
  const prefix = `[${ts}] ${LEVEL_PREFIX[level]} [${tag}]`;

  // Console output (respecting level)
  if (LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_CONSOLE_LEVEL]) {
    const fullMessage = data !== undefined ? `${message}` : message;
    if (level === 'error') {
      console.error(`${prefix} ${fullMessage}`, data ?? '');
    } else if (level === 'warn') {
      console.warn(`${prefix} ${fullMessage}`, data ?? '');
    } else {
      console.log(`${prefix} ${fullMessage}`, data ?? '');
    }
  }

  // Future: persist to local DB for /api/logs route
  // (skip for now — avoid DB writes on every log)
}

// Pre-configured loggers per module
export const logger = {
  debug: (tag: string, msg: string, data?: any) => log('debug', tag, msg, data),
  info: (tag: string, msg: string, data?: any) => log('info', tag, msg, data),
  warn: (tag: string, msg: string, data?: any) => log('warn', tag, msg, data),
  error: (tag: string, msg: string, data?: any) => log('error', tag, msg, data),
};

// Convenience: create a tagged logger (e.g., const log = createLogger('PsyLive4'))
export function createLogger(tag: string) {
  return {
    debug: (msg: string, data?: any) => log('debug', tag, msg, data),
    info: (msg: string, data?: any) => log('info', tag, msg, data),
    warn: (msg: string, data?: any) => log('warn', tag, msg, data),
    error: (msg: string, data?: any) => log('error', tag, msg, data),
  };
}
