/**
 * Standardized API response helpers.
 *
 * Every REST response goes through one of these so the shape
 * stays consistent across the entire API surface.
 */

/**
 * Send a success response.
 *
 * @param {import('express').Response} res
 * @param {object|null} data — payload (omitted when null)
 * @param {number} statusCode — defaults to 200
 */
export function sendSuccess(res, data = null, statusCode = 200) {
  const body = { status: 'success' };

  if (data !== null) {
    body.data = data;
  }

  return res.status(statusCode).json(body);
}

/**
 * Send an error response.
 *
 * @param {import('express').Response} res
 * @param {string} code — machine-readable error code
 * @param {string} message — human-readable message
 * @param {number} statusCode — HTTP status code
 */
export function sendError(res, code, message, statusCode = 500) {
  return res.status(statusCode).json({
    error: {
      code,
      message
    }
  });
}
