import logger from '../utils/logger.js';
import { BAD_REQUEST, INTERNAL_ERROR } from '../errors/error-codes.js';

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
  const isPayloadTooLarge = err.type === 'entity.too.large';
  const isInvalidJson = err.type === 'entity.parse.failed';
  // ── Determine status & codes ────────────────────────────────
  const statusCode = isPayloadTooLarge
    ? 413
    : isInvalidJson
      ? 400
      : err.statusCode || 500;
  const code = isPayloadTooLarge || isInvalidJson
    ? BAD_REQUEST
    : err.code || INTERNAL_ERROR;

  // For non-operational (unexpected) errors, use a generic message
  // so internals are never leaked.
  const message = isPayloadTooLarge
    ? 'Request body too large.'
    : isInvalidJson
      ? 'Invalid JSON request body.'
      : err.isOperational
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
  if (
    process.env.NODE_ENV === 'development'
    && err.stack
    && !isPayloadTooLarge
    && !isInvalidJson
  ) {
    body.error.stack = err.stack;
  }

  return res.status(statusCode).json(body);
}
