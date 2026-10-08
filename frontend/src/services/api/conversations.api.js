import { api } from './client.js';

/**
 * Fetch all conversations for the authenticated user.
 * @returns {Promise<{ conversations: any[] }>}
 */
export const listConversations = () => {
  return api.get('/api/conversations');
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
