/**
 * AppError — centralized application error.
 *
 * Every operational error thrown intentionally should use this class
 * so the error middleware can map it to a consistent API response.
 */
class AppError extends Error {
  /**
   * @param {string} message  — human-readable description (safe for client)
   * @param {number} statusCode — HTTP status code (e.g. 400, 401, 404)
   * @param {string} code — machine-readable error code (e.g. 'VALIDATION_ERROR')
   */
  constructor(message, statusCode, code) {
    super(message);

    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    // Capture the stack only for non-production environments.
    Error.captureStackTrace(this, this.constructor);
  }

  // ── Factory helpers ──────────────────────────────────────────

  static badRequest(message = 'Bad request', code = 'BAD_REQUEST') {
    return new AppError(message, 400, code);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new AppError(message, 401, code);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new AppError(message, 403, code);
  }

  static notFound(message = 'Resource not found', code = 'RESOURCE_NOT_FOUND') {
    return new AppError(message, 404, code);
  }

  static conflict(message = 'Conflict', code = 'CONFLICT') {
    return new AppError(message, 409, code);
  }

  static unprocessable(message = 'Unprocessable entity', code = 'UNPROCESSABLE_ENTITY') {
    return new AppError(message, 422, code);
  }

  static tooMany(message = 'Too many requests', code = 'TOO_MANY_REQUESTS') {
    return new AppError(message, 429, code);
  }

  static internal(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    return new AppError(message, 500, code);
  }
}

export default AppError;
