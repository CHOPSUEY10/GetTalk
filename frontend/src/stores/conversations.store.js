import { writable, get } from 'svelte/store';
import { listConversations, getConversation, createConversation } from '../services/api/conversations.api.js';
import { handleApiError } from '../errors/apierror.js';
import { PAGE_ERROR_CODES, resolvePageError } from '../errors/pageerror.js';

/**
 * @typedef {Object} ConversationState
 * @property {any[]} conversations
 * @property {string | null} activeConversationId
 * @property {any | null} activeConversation
 * @property {boolean} loading
 * @property {string | null} error
 * @property {string | null} [errorCode]
 */

/** @type {ConversationState} */
const initialState = {
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  loading: false,
  error: null,
  errorCode: null,
};

function createConversationsStore() {
  const { subscribe, set, update } = writable(initialState);

  return {
    subscribe,

    /**
     * Load all conversations from REST API.
     */
    loadConversations: async () => {
      update((s) => ({ ...s, loading: true, error: null, errorCode: null }));
      try {
        const res = await listConversations();
        const list = Array.isArray(res) ? res : res?.conversations || [];
        update((s) => ({
          ...s,
          conversations: list,
          loading: false,
          error: null,
          errorCode: null,
        }));
        return list;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/conversations',
          method: 'GET',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'chat',
          fallbackCode: PAGE_ERROR_CODES.CONVERSATION_LOAD_FAILED,
        });
        update((s) => ({
          ...s,
          loading: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        return [];
      }
    },

    /**
     * Select / fetch active conversation details.
     * @param {string} conversationId
     */
    selectConversation: async (conversationId) => {
      if (!conversationId) return null;

      update((s) => ({
        ...s,
        activeConversationId: conversationId,
      }));

      // Check if already in cache
      const current = get({ subscribe });
      const found = current.conversations.find((c) => c.id === conversationId);
      if (found) {
        update((s) => ({ ...s, activeConversation: found }));
        return found;
      }

      // Otherwise fetch from API
      try {
        const res = await getConversation(conversationId);
        const conv = res?.conversation || res;
        update((s) => ({
          ...s,
          activeConversation: conv,
        }));
        return conv;
      } catch (err) {
        handleApiError(err, {
          endpoint: '/api/conversations',
          method: 'GET',
        });
        return null;
      }
    },

    /**
     * Create or open direct conversation with a friend.
     * @param {string} targetUserId
     * @returns {Promise<string | null>} conversationId
     */
    createOrOpenDirectChat: async (targetUserId) => {
      if (!targetUserId) return null;
      update((s) => ({ ...s, loading: true, error: null, errorCode: null }));

      try {
        const res = await createConversation({ userId: targetUserId });
        const conv = res?.conversation || res;
        const convId = conv?.id;

        update((s) => {
          const exists = s.conversations.some((c) => c.id === convId);
          return {
            ...s,
            conversations: exists ? s.conversations : [conv, ...s.conversations],
            activeConversationId: convId,
            activeConversation: conv,
            loading: false,
          };
        });

        return convId;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/conversations',
          method: 'POST',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'chat',
          fallbackCode: PAGE_ERROR_CODES.CONVERSATION_CREATE_FAILED,
        });
        update((s) => ({
          ...s,
          loading: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },

    /**
     * Update last message in conversation list when a new message arrives.
     * @param {string} conversationId
     * @param {any} message
     */
    updateLastMessage: (conversationId, message) => {
      update((s) => {
        const updated = s.conversations.map((c) => {
          if (c.id === conversationId) {
            return {
              ...c,
              last_message: message,
              updated_at: message.created_at || new Date().toISOString(),
            };
          }
          return c;
        });

        return {
          ...s,
          conversations: updated,
        };
      });
    },

    reset: () => {
      set(initialState);
    },
  };
}

export const conversationsStore = createConversationsStore();
export const conversationStore = conversationsStore;
