/**
 * Reusable Pagination Validator & Helpers (Rule #5, #9, #13)
 *
 * Verifies positive integer limits, maximum bounds, non-negative integer offsets,
 * and UUID / ISO-8601 string cursors.
 */

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ISO_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 50;

/**
 * Check whether a cursor string is a valid UUID or ISO-8601 timestamp.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidCursor(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  if (UUID_REGEX.test(value)) {
    return true;
  }
  if (ISO_TIMESTAMP_REGEX.test(value) && !Number.isNaN(Date.parse(value))) {
    return true;
  }
  return false;
}

/**
 * Validate pagination query parameters (`limit`, `offset`, and cursor param such as `before` / `after` / `cursor`).
 *
 * Supports both direct calls `validatePaginationQuery(req.query, 'before')` /
 * `validatePaginationQuery(req.query, { maxLimit: 50, cursorParam: 'before' })`
 * and Express `validate(validatePaginationQuery)` middleware signature `(body, req)`.
 *
 * @param {Record<string, any>} [queryOrBody]
 * @param {string | {
 *   cursorParam?: string,
 *   maxLimit?: number,
 *   allowOffset?: boolean,
 *   allowCursor?: boolean,
 *   query?: Record<string, any>
 * }} [optionsOrCursorParam]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePaginationQuery(queryOrBody = {}, optionsOrCursorParam = 'before') {
  let queryParams = queryOrBody || {};
  let cursorParam = 'before';
  let maxLimit = MAX_PAGE_LIMIT;
  let allowOffset = true;
  let allowCursor = true;

  if (typeof optionsOrCursorParam === 'string') {
    cursorParam = optionsOrCursorParam;
  } else if (optionsOrCursorParam && typeof optionsOrCursorParam === 'object') {
    // Check if invoked as Express middleware validator: validateFn(req.body, req)
    if ('query' in optionsOrCursorParam && ('params' in optionsOrCursorParam || 'headers' in optionsOrCursorParam)) {
      queryParams = optionsOrCursorParam.query || {};
    } else {
      if (optionsOrCursorParam.cursorParam) cursorParam = optionsOrCursorParam.cursorParam;
      if (typeof optionsOrCursorParam.maxLimit === 'number') maxLimit = optionsOrCursorParam.maxLimit;
      if (typeof optionsOrCursorParam.allowOffset === 'boolean') allowOffset = optionsOrCursorParam.allowOffset;
      if (typeof optionsOrCursorParam.allowCursor === 'boolean') allowCursor = optionsOrCursorParam.allowCursor;
    }
  }

  const errors = [];
  const { limit, offset } = queryParams;
  const cursor = queryParams[cursorParam];

  if (limit !== undefined) {
    const limitStr = typeof limit === 'number' ? String(limit) : limit;
    if (typeof limitStr !== 'string' || !/^\d+$/.test(limitStr)) {
      errors.push('limit must be a positive integer');
    } else {
      const parsed = Number(limitStr);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maxLimit) {
        errors.push(`limit must be between 1 and ${maxLimit}`);
      }
    }
  }

  if (offset !== undefined) {
    if (!allowOffset) {
      errors.push('offset parameter is not supported on this endpoint');
    } else {
      const offsetStr = typeof offset === 'number' ? String(offset) : offset;
      if (typeof offsetStr !== 'string' || !/^\d+$/.test(offsetStr)) {
        errors.push('offset must be a non-negative integer');
      } else {
        const parsedOffset = Number(offsetStr);
        if (!Number.isSafeInteger(parsedOffset) || parsedOffset < 0) {
          errors.push('offset must be a non-negative integer');
        }
      }
    }
  }

  if (cursor !== undefined) {
    if (!allowCursor) {
      errors.push(`${cursorParam} parameter is not supported on this endpoint`);
    } else if (!isValidCursor(cursor)) {
      errors.push(`${cursorParam} must be a valid cursor`);
    }
  }

  // If generic `cursor` param is also supplied alongside a named cursorParam, validate it too
  if (cursorParam !== 'cursor' && queryParams.cursor !== undefined) {
    if (!allowCursor) {
      errors.push('cursor parameter is not supported on this endpoint');
    } else if (!isValidCursor(queryParams.cursor)) {
      errors.push('cursor must be a valid cursor');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Factory to create an Express-compatible validator function `(body, req) => { valid, errors }`
 * with custom pagination constraints.
 *
 * @param {{
 *   cursorParam?: string,
 *   maxLimit?: number,
 *   allowOffset?: boolean,
 *   allowCursor?: boolean
 * }} [options]
 */
export function createPaginationValidator(options = {}) {
  return (_body, req) => validatePaginationQuery(req?.query || {}, options);
}

