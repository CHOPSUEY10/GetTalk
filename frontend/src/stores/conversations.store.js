import { writable, get } from 'svelte/store';
import { listConversations, getConversation, createConversation } from '../services/api/conversations.api.js';
import { establishConversationSession } from '../services/crypto/conversation-session.js';
import { IdentityKeyChangedError, acceptChangedPeerKey } from '../services/crypto/identity-trust.js';
import { handleApiError } from '../lib/errors/apierror.js';
import { PAGE_ERROR_CODES, resolvePageError, getPageErrorMessage } from '../lib/errors/pageerror.js';

/**
 * @typedef {Object} KeyChangeInfo
 * @property {string} userId
 * @property {string} previousFingerprint
 * @property {string} fingerprint
 */

/**
 * @typedef {Object} ConversationState
 * @property {any[]} conversations
 * @property {string | null} activeConversationId
 * @property {any | null} activeConversation
 * @property {boolean} loading
 * @property {string | null} error
 * @property {string | null} [errorCode]
 * @property {'initializing' | 'ready' | 'error' | 'keyChange'} e2eeStatus
 * @property {string | null} e2eeError
 * @property {KeyChangeInfo | null} keyChange
 */

/** @type {ConversationState} */
const initialState = {
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  loading: false,
  error: null,
  errorCode: null,
  e2eeStatus: 'initializing',
  e2eeError: null,
  keyChange: null,
};

function createConversationsStore() {
  const { subscribe, set, update } = writable(initialState);

  const conversationsStore = {
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
     * Initialize E2EE session for a conversation (Rule #3, #17, #20).
     * Wraps `establishConversationSession` and records session status in the store.
     *
     * @param {string} conversationId
     * @param {string | undefined} currentUserId
     * @returns {Promise<{
     *   status: 'initializing' | 'ready' | 'error' | 'keyChange',
     *   error: string | null,
     *   keyChange: KeyChangeInfo | null,
     *   conversation: any | null
     * }>}
     */
    initE2EESession: async (conversationId, currentUserId) => {
      if (!conversationId) {
        return {
          status: 'error',
          error: getPageErrorMessage(PAGE_ERROR_CODES.E2EE_PEER_UNAVAILABLE, 'e2ee'),
          keyChange: null,
          conversation: null,
        };
      }

      update((s) => ({
        ...s,
        e2eeStatus: 'initializing',
        e2eeError: null,
        keyChange: null,
      }));

      const conv = await conversationsStore.selectConversation(conversationId);
      const peerId = conv?.peer?.id;

      if (!currentUserId || !peerId) {
        const errMsg = getPageErrorMessage(PAGE_ERROR_CODES.E2EE_PEER_UNAVAILABLE, 'e2ee');
        update((s) => ({
          ...s,
          e2eeStatus: 'error',
          e2eeError: errMsg,
          keyChange: null,
        }));
        return {
          status: 'error',
          error: errMsg,
          keyChange: null,
          conversation: conv,
        };
      }

      try {
        await establishConversationSession({
          conversationId,
          currentUserId,
          peerUserId: peerId,
        });
        update((s) => ({
          ...s,
          e2eeStatus: 'ready',
          e2eeError: null,
          keyChange: null,
        }));
        return {
          status: 'ready',
          error: null,
          keyChange: null,
          conversation: conv,
        };
      } catch (err) {
        if (err instanceof IdentityKeyChangedError) {
          /** @type {KeyChangeInfo} */
          const keyChange = {
            userId: err.userId,
            previousFingerprint: err.previousFingerprint,
            fingerprint: err.fingerprint,
          };
          const errMsg = getPageErrorMessage(PAGE_ERROR_CODES.IDENTITY_KEY_CHANGED, 'e2ee');
          update((s) => ({
            ...s,
            e2eeStatus: 'keyChange',
            e2eeError: errMsg,
            keyChange,
          }));
          return {
            status: 'keyChange',
            error: errMsg,
            keyChange,
            conversation: conv,
          };
        }

        const errMsg = getPageErrorMessage(err, {
          context: 'e2ee',
          fallbackCode: PAGE_ERROR_CODES.KEY_EXCHANGE_FAILED,
        });
        update((s) => ({
          ...s,
          e2eeStatus: 'error',
          e2eeError: errMsg,
          keyChange: null,
        }));
        return {
          status: 'error',
          error: errMsg,
          keyChange: null,
          conversation: conv,
        };
      }
    },

    /**
     * Accept a peer's changed identity key after out-of-band fingerprint verification (Rule #17)
     * and re-initialize the E2EE session.
     *
     * @param {string} conversationId
     * @param {string | undefined} currentUserId
     * @param {string} [peerUserId]
     */
    acceptPeerKeyChange: async (conversationId, currentUserId, peerUserId) => {
      const current = get({ subscribe });
      const targetUserId = peerUserId || current.keyChange?.userId;
      if (!targetUserId) return null;

      try {
        await acceptChangedPeerKey(targetUserId);
        return await conversationsStore.initE2EESession(conversationId, currentUserId);
      } catch (err) {
        const errMsg = getPageErrorMessage(err, {
          context: 'e2ee',
          fallbackCode: PAGE_ERROR_CODES.KEY_EXCHANGE_FAILED,
        });
        update((s) => ({
          ...s,
          e2eeStatus: 'error',
          e2eeError: errMsg,
        }));
        throw err;
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

  return conversationsStore;
}

export const conversationsStore = createConversationsStore();
export const conversationStore = conversationsStore;
