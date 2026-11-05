import { api } from './client.js';

export const getCurrentUser = () => {
  return api.get('/api/users/me');
};

/**
 * Search users by username with optional pagination params (`limit`, `offset`).
 * Supports both `searchUsers('alice', { limit, offset })` and `searchUsers({ q: 'alice', limit, offset })`.
 *
 * @param {string | { q?: string, query?: string, limit?: number, offset?: number }} queryOrParams
 * @param {{ limit?: number, offset?: number }} [params]
 * @returns {Promise<{
 *   data: any[],
 *   users: any[],
 *   hasMore: boolean,
 *   pagination: { limit: number, offset: number, total: number, hasMore: boolean }
 * }>}
 */
export const searchUsers = (queryOrParams, params = {}) => {
  let q = '';
  let limit = params?.limit;
  let offset = params?.offset;

  if (typeof queryOrParams === 'string') {
    q = queryOrParams;
  } else if (queryOrParams && typeof queryOrParams === 'object') {
    q = queryOrParams.q ?? queryOrParams.query ?? '';
    if (queryOrParams.limit !== undefined) limit = queryOrParams.limit;
    if (queryOrParams.offset !== undefined) offset = queryOrParams.offset;
  }

  const searchParams = new URLSearchParams();
  searchParams.set('q', q);
  if (limit !== undefined && limit !== null) {
    searchParams.set('limit', String(limit));
  }
  if (offset !== undefined && offset !== null) {
    searchParams.set('offset', String(offset));
  }

  return api.get(`/api/users/search?${searchParams.toString()}`);
};

/** @param {string} userId */
export const getUser = (userId) => {
  const safeUserId = encodeURIComponent(userId);
  return api.get(`/api/users/${safeUserId}`);
};
