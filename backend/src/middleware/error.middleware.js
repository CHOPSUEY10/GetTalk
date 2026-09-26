import logger from '../utils/logger.js';
import { INTERNAL_ERROR } from '../errors/error-codes.js';

/**
 * Global Express error-handling middleware.
 *
 * Registered as the LAST middleware in app.js (4-argument signature).
 * Converts any error — AppError or unexpected — into the standard
 * JSON error envelope defined in rule.md §31.
 *
 * Security:
 *  - Stack traces are only included in development.
 *  - SQL, filesystem paths, and secrets are never forwarded to the client.
 */
// eslint-disable-next-line no-unused-vars -- Express requires 4 params
export function errorHandler(err, req, res, _next) {
  // ── Determine status & codes ────────────────────────────────
  const statusCode = err.statusCode || 500;
  const code = err.code || INTERNAL_ERROR;

  // For non-operational (unexpected) errors, use a generic message
  // so internals are never leaked.
  const message = err.isOperational
    ? err.message
    : 'Internal server error';

  // ── Log ──────────────────────────────────────────────────────
  if (statusCode >= 500) {
    logger.error(`[${req.method}] ${req.originalUrl} — ${err.message}`, {
      statusCode,
      code,
      stack: err.stack
    });
  } else {
    logger.warn(`[${req.method}] ${req.originalUrl} — ${err.message}`, {
      statusCode,
      code
    });
  }

  // ── Build response ──────────────────────────────────────────
  const body = {
    error: {
      code,
      message
    }
  };

  // Attach stack in development only (never in production).
  if (process.env.NODE_ENV === 'development' && err.stack) {
    body.error.stack = err.stack;
  }

  return res.status(statusCode).json(body);
}
