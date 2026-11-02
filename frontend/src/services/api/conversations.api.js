import { api } from './client.js';

/**
 * Fetch conversations for the authenticated user (cursor-paginated).
 * @param {{ limit?: number, before?: string }} [params]
 * @returns {Promise<{ conversations: any[], nextCursor: string | null }>}
 */
export const listConversations = (params = {}) => {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.before) query.set('before', params.before);
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

// Aliases for backward compatibility
export const conversationList = listConversations;
