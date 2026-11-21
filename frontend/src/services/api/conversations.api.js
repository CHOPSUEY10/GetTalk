import { api } from './client.js';

/**
 * Fetch conversations for the authenticated user (cursor-paginated).
 * @param {{ limit?: number, before?: string, cursor?: string, offset?: number }} [params]
 * @returns {Promise<{
 *   data: any[],
 *   conversations: any[],
 *   nextCursor: string | null,
 *   hasMore: boolean,
 *   pagination: { limit: number, nextCursor: string | null, hasMore: boolean }
 * }>}
 */
export const listConversations = (params = {}) => {
  const query = new URLSearchParams();
  if (params.limit !== undefined && params.limit !== null) {
    query.set('limit', String(params.limit));
  }
  const beforeCursor = params.before ?? params.cursor;
  if (beforeCursor !== undefined && beforeCursor !== null && beforeCursor !== '') {
    query.set('before', String(beforeCursor));
  }
  if (params.offset !== undefined && params.offset !== null) {
    query.set('offset', String(params.offset));
  }
  const qs = query.toString() ? `?${query.toString()}` : '';

  return api.get(`/api/conversations${qs}`);
};

/**
 * Get details of a specific conversation.
 * @param {string} conversationId
 * @returns {Promise<{ conversation: any }>}
 */
export const getConversation = (conversationId) => {
  return api.get(`/api/conversations/${conversationId}`);
};

/**
 * Create a new direct conversation with a user.
 * @param {{ userId: string }} payload
 * @returns {Promise<{ conversation: any }>}
 */
export const createConversation = (payload) => {
  return api.post('/api/conversations', payload);
};

/**
 * Clear all messages in a conversation and hide it from the sidebar.
 * @param {string} conversationId
 * @param {{ scope?: 'me' | 'everyone' }} [options]
 * @returns {Promise<{
 *   conversationId: string,
 *   scope: 'me' | 'everyone',
 *   clearedAt: string,
 *   deletedMessageCount: number | null
 * }>}
 */
export const clearConversation = (conversationId, { scope = 'me' } = {}) => {
  const normalizedScope = scope === 'everyone' ? 'everyone' : 'me';
  const qs = `?scope=${encodeURIComponent(normalizedScope)}`;
  return api.delete(`/api/conversations/${encodeURIComponent(conversationId)}${qs}`);
};

// Aliases for backward compatibility
export const conversationList = listConversations;
