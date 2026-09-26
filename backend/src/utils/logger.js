/**
 * Minimal structured logger.
 *
 * Wraps console methods to attach a timestamp and level.
 * Ensures passwords, tokens, and keys never appear in log output
 * by design — callers must never pass secrets as arguments.
 *
 * In production this can later be swapped for a transport-based
 * logger (e.g. pino or winston) without changing the call sites.
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = process.env.LOG_LEVEL || 'info';

function shouldLog(level) {
  return (LOG_LEVELS[level] ?? 2) <= (LOG_LEVELS[currentLevel] ?? 2);
}

function formatMessage(level, message, meta) {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  if (meta !== undefined) {
    return `${base} ${JSON.stringify(meta)}`;
  }

  return base;
}

const logger = {
  error(message, meta) {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, meta));
    }
  },

  warn(message, meta) {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, meta));
    }
  },

  info(message, meta) {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, meta));
    }
  },

  debug(message, meta) {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, meta));
    }
  }
};

export default logger;
