import AppError from '../errors/AppError.js';
import { ROUTE_NOT_FOUND } from '../errors/error-codes.js';

/**
 * Catch-all for requests that don't match any registered route.
 * Must be registered AFTER all valid routes.
 */
export function notFoundHandler(req, res, next) {
  next(
    new AppError(
      `Route ${req.method} ${req.originalUrl} not found`,
      404,
      ROUTE_NOT_FOUND
    )
  );
}
