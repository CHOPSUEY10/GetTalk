/**
 * Cursor (keyset) and offset pagination helpers shared by list endpoints.
 *
 * Cursors are opaque resource IDs (UUIDs) or ISO-8601 timestamps of the last
 * item on the previous page. Repositories resolve the cursor's sort key
 * server-side and compare with a `(sortKey, id)` tuple so items sharing a
 * timestamp/name are never skipped or duplicated between pages.
 */

import {
  UUID_REGEX,
  ISO_TIMESTAMP_REGEX,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  isValidCursor,
  validatePaginationQuery,
  createPaginationValidator,
} from '../validators/pagination.validator.js';

export {
  UUID_REGEX,
  ISO_TIMESTAMP_REGEX,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  isValidCursor,
  validatePaginationQuery,
  createPaginationValidator,
};

/**
 * Parse already-validated query params into `{ limit, cursor }`.
 *
 * @param {Record<string, any>} [queryParams]
 * @param {string | { cursorParam?: string, defaultLimit?: number }} [optionsOrCursorParam]
 * @returns {{ limit: number, cursor: string | null }}
 */
export function parsePaginationQuery(queryParams = {}, optionsOrCursorParam = 'before') {
  let cursorParam = 'before';
  let defaultLimit = DEFAULT_PAGE_LIMIT;

  if (typeof optionsOrCursorParam === 'string') {
    cursorParam = optionsOrCursorParam;
  } else if (optionsOrCursorParam && typeof optionsOrCursorParam === 'object') {
    if (optionsOrCursorParam.cursorParam) cursorParam = optionsOrCursorParam.cursorParam;
    if (typeof optionsOrCursorParam.defaultLimit === 'number') {
      defaultLimit = optionsOrCursorParam.defaultLimit;
    }
  }

  const limit =
    queryParams.limit !== undefined && queryParams.limit !== ''
      ? Number(queryParams.limit)
      : defaultLimit;
  const cursor = queryParams[cursorParam] || queryParams.cursor || null;
  return { limit, cursor };
}

/**
 * Parse already-validated offset pagination query params into `{ limit, offset, cursor }`.
 *
 * @param {Record<string, any>} [queryParams]
 * @param {{ defaultLimit?: number, cursorParam?: string }} [options]
 * @returns {{ limit: number, offset: number, cursor: string | null }}
 */
export function parseOffsetPaginationQuery(
  queryParams = {},
  { defaultLimit = 20, cursorParam = 'after' } = {}
) {
  const limit =
    queryParams.limit !== undefined && queryParams.limit !== ''
      ? Number(queryParams.limit)
      : defaultLimit;
  const offset =
    queryParams.offset !== undefined && queryParams.offset !== ''
      ? Number(queryParams.offset)
      : 0;
  const cursor = queryParams[cursorParam] || queryParams.cursor || null;
  return { limit, offset, cursor };
}

/**
 * Repositories fetch `limit + 1` rows; this trims the extra row and derives
 * `nextCursor` and `hasMore` without an extra COUNT query.
 *
 * @template T
 * @param {T[]} rows
 * @param {number} limit
 * @param {(row: T) => string} [getId]
 * @returns {{
 *   items: T[],
 *   data: T[],
 *   nextCursor: string | null,
 *   hasMore: boolean,
 *   pagination: { limit: number, nextCursor: string | null, hasMore: boolean }
 * }}
 */
export function buildPage(rows, limit, getId = (row) => row.id) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? getId(items[items.length - 1]) : null;
  return {
    items,
    data: items,
    nextCursor,
    hasMore,
    pagination: {
      limit,
      nextCursor,
      hasMore,
    },
  };
}

/**
 * Build standardized offset pagination envelope.
 *
 * @template T
 * @param {T[]} rows
 * @param {{ limit: number, offset?: number, total?: number, nextCursor?: string | null }} meta
 * @returns {{
 *   items: T[],
 *   data: T[],
 *   limit: number,
 *   offset: number,
 *   total: number,
 *   hasMore: boolean,
 *   nextCursor?: string | null,
 *   pagination: { limit: number, offset: number, total: number, hasMore: boolean, nextCursor?: string | null }
 * }}
 */
export function buildOffsetPage(rows, { limit, offset = 0, total = 0, nextCursor } = {}) {
  const hasMore = offset + rows.length < total;
  const pagination = {
    limit,
    offset,
    total,
    hasMore,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };

  return {
    items: rows,
    data: rows,
    limit,
    offset,
    total,
    hasMore,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    pagination,
  };
}
