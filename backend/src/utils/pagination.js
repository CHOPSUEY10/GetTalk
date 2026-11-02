/**
 * Cursor (keyset) pagination helpers shared by list endpoints.
 *
 * Cursors are opaque resource IDs (UUIDs) of the last item on the previous
 * page. Repositories resolve the cursor's sort key server-side and compare
 * with a `(sortKey, id)` tuple so items sharing a timestamp/name are never
 * skipped or duplicated between pages.
 */

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

/**
 * Validate `limit` and a cursor query param. Returns validator-style result
 * consumable by `validate()` middleware.
 *
 * @param {Record<string, any>} queryParams
 * @param {string} cursorParam - name of the cursor param (`before` / `after`)
 */
export function validatePaginationQuery(queryParams = {}, cursorParam = 'before') {
  const errors = [];
  const { limit } = queryParams;
  const cursor = queryParams[cursorParam];

  if (limit !== undefined) {
    if (typeof limit !== 'string' || !/^\d+$/.test(limit)) {
      errors.push('limit must be a positive integer');
    } else {
      const parsed = Number(limit);
      if (parsed < 1 || parsed > MAX_PAGE_LIMIT) {
        errors.push(`limit must be between 1 and ${MAX_PAGE_LIMIT}`);
      }
    }
  }

  if (cursor !== undefined) {
    if (typeof cursor !== 'string' || !UUID_REGEX.test(cursor)) {
      errors.push(`${cursorParam} must be a valid cursor`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parse already-validated query params into `{ limit, cursor }`.
 *
 * @param {Record<string, any>} queryParams
 * @param {string} cursorParam
 */
export function parsePaginationQuery(queryParams = {}, cursorParam = 'before') {
  const limit = queryParams.limit ? Number(queryParams.limit) : DEFAULT_PAGE_LIMIT;
  const cursor = queryParams[cursorParam] || null;
  return { limit, cursor };
}

/**
 * Repositories fetch `limit + 1` rows; this trims the extra row and derives
 * `nextCursor` without an extra COUNT query.
 *
 * @template T
 * @param {T[]} rows
 * @param {number} limit
 * @param {(row: T) => string} getId
 * @returns {{ items: T[], nextCursor: string | null }}
 */
export function buildPage(rows, limit, getId = (row) => row.id) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? getId(items[items.length - 1]) : null;
  return { items, nextCursor };
}

