import AppError from '../errors/AppError.js';
import { FORBIDDEN } from '../errors/error-codes.js';

/**
 * Authorization middleware factory (plan §20, rule §14).
 *
 * Use for resource-specific permission checks:
 *  - conversation membership
 *  - message ownership
 *  - attachment access
 *  - friendship operation
 *
 * @param {string} resource — human-readable resource name for error messages
 * @param {Function} checkFn — async (req) => boolean
 * @returns Express middleware
 */
export function authorize(resource, checkFn) {
  return async (req, res, next) => {
    try {
      const allowed = await checkFn(req);

      if (!allowed) {
        return next(
          new AppError(
            `You do not have permission to access this ${resource}`,
            403,
            FORBIDDEN
          )
        );
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
