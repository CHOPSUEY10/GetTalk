import AppError from '../errors/AppError.js';
import { VALIDATION_ERROR } from '../errors/error-codes.js';

/**
 * Validation middleware factory (plan §18, rule §30).
 *
 * Wraps a validation function so that invalid input
 * is rejected before reaching the controller.
 *
 * @param {Function} validateFn — (body, req) => { valid: boolean, errors?: string[], error?: string, statusCode?: number }
 * @returns Express middleware
 */
export function validate(validateFn) {
  return (req, res, next) => {
    try {
      const result = validateFn(req.body, req);

      if (result && result.valid === false) {
        const message = (result.errors && result.errors.length)
          ? result.errors.join(', ')
          : (result.error || 'Validation failed');

        return next(
          new AppError(message, result.statusCode || 400, VALIDATION_ERROR)
        );
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
