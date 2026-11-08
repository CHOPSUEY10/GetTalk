import { writable, get } from 'svelte/store';
import { listConversations, getConversation, createConversation } from '../services/api/conversations.api.js';
import {
  establishConversationSession,
  getConversationSessionPeer,
} from '../services/crypto/conversation-session.js';
import {
  IdentityKeyChangedError,
  acceptChangedPeerKey,
  getPeerSafetyNumber,
  setPeerVerificationStatus,
  getVerificationStatus,
  revokeVerificationStatus,
} from '../services/crypto/identity-trust.js';
import { handleApiError } from '../lib/errors/apierror.js';
import { PAGE_ERROR_CODES, resolvePageError, getPageErrorMessage } from '../lib/errors/pageerror.js';

export const DEFAULT_CONVERSATIONS_PAGE_LIMIT = 20;

/** @type {((conversationId: string) => Promise<any>) | null} */
let keyChangeAcceptedFlushHandler = null;

/**
 * Register a callback invoked when a peer's new identity key is accepted and the E2EE session is ready.
 * @param {(conversationId: string) => Promise<any>} fn
 */
export function registerKeyChangeAcceptedFlushHandler(fn) {
  keyChangeAcceptedFlushHandler = fn;
}

/**
 * @typedef {Object} KeyChangeInfo
 * @property {string} userId
 * @property {string} previousFingerprint
 * @property {string} fingerprint
 */

/**
 * @typedef {Object} ConversationPaginationMeta
 * @property {number} limit
 * @property {string | null} nextCursor
 * @property {boolean} hasMore
 */

/**
 * @typedef {Object} ConversationState
 * @property {any[]} conversations
 * @property {string | null} activeConversationId
 * @property {any | null} activeConversation
 * @property {boolean} loading
 * @property {boolean} loadingMore
 * @property {string | null} nextCursor
 * @property {boolean} hasMore
 * @property {ConversationPaginationMeta} pagination
 * @property {string | null} error
 * @property {string | null} [errorCode]
 * @property {'initializing' | 'ready' | 'error' | 'keyChange'} e2eeStatus
 * @property {string | null} e2eeError
 * @property {KeyChangeInfo | null} keyChange
 * @property {boolean} peerVerified
 * @property {number | null} peerVerifiedAt
 * @property {any | null} safetyNumber
 * @property {boolean} safetyNumberLoading
 */

/** @type {ConversationState} */
const initialState = {
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  loading: false,
  loadingMore: false,
  nextCursor: null,
  hasMore: false,
  pagination: {
    limit: DEFAULT_CONVERSATIONS_PAGE_LIMIT,
    nextCursor: null,
    hasMore: false,
  },
  error: null,
  errorCode: null,
  e2eeStatus: 'initializing',
  e2eeError: null,
  keyChange: null,
  peerVerified: false,
  peerVerifiedAt: null,
  safetyNumber: null,
  safetyNumberLoading: false,
};

function createConversationsStore() {
  const { subscribe, set, update } = writable(initialState);

  const conversationsStore = {
    subscribe,

    /**
     * Load initial page of conversations from REST API (cursor-paginated).
     * @param {{ limit?: number }} [options]
     */
    loadConversations: async ({ limit = DEFAULT_CONVERSATIONS_PAGE_LIMIT } = {}) => {
      update((s) => ({ ...s, loading: true, error: null, errorCode: null }));
      try {
        const res = await listConversations({ limit });
        const list = Array.isArray(res) ? res : (res?.data || res?.conversations || []);
        const nextCursor = res?.pagination?.nextCursor ?? res?.nextCursor ?? null;
        const hasMore = res?.pagination?.hasMore ?? res?.hasMore ?? Boolean(nextCursor);
        const pageLimit = res?.pagination?.limit ?? limit;

        update((s) => ({
          ...s,
          conversations: list,
          nextCursor,
          hasMore,
          pagination: {
            limit: pageLimit,
            nextCursor,
            hasMore,
          },
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
     * Load next page of conversations using `nextCursor` (`before` cursor) and append without duplicates.
     * @param {{ limit?: number }} [options]
     * @returns {Promise<any[]>}
     */
    loadMoreConversations: async ({ limit } = {}) => {
      const current = get({ subscribe });
      if (
        current.loading ||
        current.loadingMore ||
        !current.hasMore ||
        !current.nextCursor
      ) {
        return [];
      }

      const pageLimit = limit || current.pagination?.limit || DEFAULT_CONVERSATIONS_PAGE_LIMIT;
      const cursor = current.nextCursor;

      update((s) => ({
        ...s,
        loadingMore: true,
        error: null,
        errorCode: null,
      }));

      try {
        const res = await listConversations({ limit: pageLimit, before: cursor });
        const incoming = Array.isArray(res) ? res : (res?.data || res?.conversations || []);
        const nextCursor = res?.pagination?.nextCursor ?? res?.nextCursor ?? null;
        const hasMore = res?.pagination?.hasMore ?? res?.hasMore ?? Boolean(nextCursor);
        const resolvedLimit = res?.pagination?.limit ?? pageLimit;

        /** @type {any[]} */
        let added = [];

        update((s) => {
          const existingIds = new Set(s.conversations.map((c) => c.id));
          added = incoming.filter((c) => !existingIds.has(c.id));
          const merged = [...s.conversations, ...added];

          return {
            ...s,
            conversations: merged,
            nextCursor,
            hasMore,
            pagination: {
              limit: resolvedLimit,
              nextCursor,
              hasMore,
            },
            loadingMore: false,
          };
        });

        return added;
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
          loadingMore: false,
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
      const sessionPeer = getConversationSessionPeer(conversationId);
      const peerId = conv?.peer?.id || sessionPeer?.peerUserId;
      const resolvedCurrentUserId = currentUserId || sessionPeer?.currentUserId;

      if (!resolvedCurrentUserId || !peerId) {
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
          currentUserId: resolvedCurrentUserId,
          peerUserId: peerId,
        });
        const verification = await getVerificationStatus(peerId);
        update((s) => ({
          ...s,
          e2eeStatus: 'ready',
          e2eeError: null,
          keyChange: null,
          peerVerified: Boolean(verification.verified),
          peerVerifiedAt: verification.verified ? verification.verifiedAt : null,
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
            peerVerified: false,
            peerVerifiedAt: null,
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
          peerVerified: false,
          peerVerifiedAt: null,
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
     * Record a peer identity key change detected mid-conversation (e.g. during message send)
     * so the UI immediately transitions to `keyChange` warning mode (Rule #17).
     *
     * @param {IdentityKeyChangedError | { userId: string, previousFingerprint: string, fingerprint: string }} err
     * @param {string} [conversationId]
     */
    recordKeyChange: (err, conversationId) => {
      if (!err) return;
      /** @type {KeyChangeInfo} */
      const keyChange = {
        userId: err.userId || '',
        previousFingerprint: err.previousFingerprint || '',
        fingerprint: err.fingerprint || '',
      };
      if (keyChange.userId) {
        revokeVerificationStatus(keyChange.userId).catch(() => { });
      }
      const errMsg = getPageErrorMessage(PAGE_ERROR_CODES.IDENTITY_KEY_CHANGED, 'e2ee');
      update((s) => ({
        ...s,
        activeConversationId: conversationId || s.activeConversationId,
        e2eeStatus: 'keyChange',
        e2eeError: errMsg,
        keyChange,
        peerVerified: false,
        peerVerifiedAt: null,
        safetyNumber: s.safetyNumber
          ? { ...s.safetyNumber, verified: false, verifiedAt: null, keyChanged: true }
          : null,
      }));
    },

    /**
     * Mark the conversation's E2EE session as ready after key verification & session establishment.
     *
     * @param {string} [conversationId]
     */
    markSessionReady: (conversationId) => {
      update((s) => ({
        ...s,
        activeConversationId: conversationId || s.activeConversationId,
        e2eeStatus: 'ready',
        e2eeError: null,
        keyChange: null,
      }));
    },

    /**
     * Accept a peer's changed identity key after out-of-band fingerprint verification (Rule #17),
     * re-initialize the E2EE session, and automatically flush any queued outgoing messages.
     *
     * @param {string} conversationId
     * @param {string | undefined} currentUserId
     * @param {string} [peerUserId]
     * @param {{ verified?: boolean }} [options]
     */
    acceptPeerKeyChange: async (conversationId, currentUserId, peerUserId, options = {}) => {
      const current = get({ subscribe });
      const sessionPeer = getConversationSessionPeer(conversationId);
      const targetUserId = peerUserId || current.keyChange?.userId || sessionPeer?.peerUserId;
      const resolvedCurrentUserId = currentUserId || sessionPeer?.currentUserId;
      if (!targetUserId) return null;

      try {
        await acceptChangedPeerKey(targetUserId, options);
        const sessionResult = await conversationsStore.initE2EESession(
          conversationId,
          resolvedCurrentUserId
        );
        if (sessionResult?.status === 'ready' && keyChangeAcceptedFlushHandler && conversationId) {
          await keyChangeAcceptedFlushHandler(conversationId);
        }
        return sessionResult;
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
     * Load the 60-digit Safety Number, local QR code SVG, and out-of-band verification state
     * for the active conversation (Rule #17, NFR-15, AC-17).
     *
     * @param {string} conversationId
     * @param {string | undefined} currentUserId
     * @param {string} [peerUserId]
     */
    loadSafetyNumber: async (conversationId, currentUserId, peerUserId) => {
      const current = get({ subscribe });
      const sessionPeer = getConversationSessionPeer(conversationId);
      const resolvedPeerId =
        peerUserId ||
        current.activeConversation?.peer?.id ||
        current.keyChange?.userId ||
        sessionPeer?.peerUserId;
      const resolvedCurrentUserId = currentUserId || sessionPeer?.currentUserId;

      if (!resolvedCurrentUserId || !resolvedPeerId) {
        return null;
      }

      update((s) => ({ ...s, safetyNumberLoading: true }));
      try {
        const info = await getPeerSafetyNumber(resolvedCurrentUserId, resolvedPeerId);
        update((s) => ({
          ...s,
          safetyNumber: info,
          safetyNumberLoading: false,
          peerVerified: info.verified,
          peerVerifiedAt: info.verifiedAt,
        }));
        return info;
      } catch {
        update((s) => ({ ...s, safetyNumberLoading: false }));
        return null;
      }
    },

    /**
     * Mark or unmark the conversation peer as verified out-of-band in IndexedDB (Rule #17).
     *
     * @param {string} conversationId
     * @param {boolean} verified
     * @param {string} [peerUserId]
     */
    togglePeerVerification: async (conversationId, verified, peerUserId) => {
      const current = get({ subscribe });
      const sessionPeer = getConversationSessionPeer(conversationId);
      const resolvedPeerId =
        peerUserId ||
        current.activeConversation?.peer?.id ||
        current.safetyNumber?.peerUserId ||
        sessionPeer?.peerUserId;

      if (!resolvedPeerId) return null;

      const updated = await setPeerVerificationStatus(
        resolvedPeerId,
        verified,
        current.safetyNumber?.peerFingerprint
      );
      update((s) => ({
        ...s,
        peerVerified: updated.verified,
        peerVerifiedAt: updated.verifiedAt,
        safetyNumber: s.safetyNumber
          ? {
            ...s.safetyNumber,
            verified: updated.verified,
            verifiedAt: updated.verifiedAt,
          }
          : null,
      }));
      return updated;
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
