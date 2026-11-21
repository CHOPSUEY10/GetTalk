import { writable, get } from 'svelte/store';
import {
  listConversations,
  getConversation,
  createConversation,
  clearConversation as apiClearConversation,
} from '../services/api/conversations.api.js';
import { registerSocketListeners } from '../services/socket/handlers.js';
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
import { ApiError, API_ERROR_CODES, handleApiError } from '../lib/errors/apierror.js';
import { PAGE_ERROR_CODES, resolvePageError, getPageErrorMessage } from '../lib/errors/pageerror.js';

export const DEFAULT_CONVERSATIONS_PAGE_LIMIT = 20;

/** @type {((conversationId: string) => Promise<any>) | null} */
let keyChangeAcceptedFlushHandler = null;

/** @type {((conversationId: string) => void) | null} */
let conversationClearedHandler = null;

/** @type {((entries: Array<{ id?: string, userId?: string, isOnline?: boolean, lastSeenAt?: string | null }>) => void) | null} */
let presenceSeedHandler = null;

/**
 * Register a callback invoked when a peer's new identity key is accepted and the E2EE session is ready.
 * @param {(conversationId: string) => Promise<any>} fn
 */
export function registerKeyChangeAcceptedFlushHandler(fn) {
  keyChangeAcceptedFlushHandler = fn;
}

/**
 * Register a callback invoked whenever a conversation is cleared/deleted (locally or via socket)
 * so domain stores such as `messagesStore` can wipe cached messages without circular imports.
 * @param {(conversationId: string) => void} fn
 */
export function registerConversationClearedHandler(fn) {
  conversationClearedHandler = fn;
}

/**
 * Register a callback to seed REST-fetched peer presence into `socketStore` without circular imports.
 * @param {(entries: Array<{ id?: string, userId?: string, isOnline?: boolean, lastSeenAt?: string | null }>) => void} fn
 */
export function registerConversationsPresenceSeedHandler(fn) {
  presenceSeedHandler = fn;
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
 * @property {Record<string, boolean>} clearingByConversation
 * @property {{ conversationId: string, scope: 'me' | 'everyone', clearedBy: string | null, clearedAt: string, isLocal: boolean } | null} lastClearedEvent
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
  clearingByConversation: {},
  lastClearedEvent: null,
};

function createConversationsStore() {
  const { subscribe, set, update } = writable(initialState);

  /** @type {(() => void) | null} */
  let cleanupListeners = null;

  /** @type {Set<string>} */
  const localClearingIds = new Set();

  /** @type {Map<string, number>} */
  const recentlyClearedLocally = new Map();

  /** @param {string} conversationId */
  function isLocallyInitiatedClear(conversationId) {
    if (localClearingIds.has(conversationId)) return true;
    const ts = recentlyClearedLocally.get(conversationId);
    if (!ts) return false;
    if (Date.now() - ts < 5000) return true;
    recentlyClearedLocally.delete(conversationId);
    return false;
  }

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
        if (presenceSeedHandler) {
          presenceSeedHandler(list.map((c) => c?.peer).filter(Boolean));
        }
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

        if (presenceSeedHandler && added.length > 0) {
          presenceSeedHandler(added.map((c) => c?.peer).filter(Boolean));
        }

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
        if (presenceSeedHandler && conv?.peer) {
          presenceSeedHandler([conv.peer]);
        }
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

        if (presenceSeedHandler && conv?.peer) {
          presenceSeedHandler([conv.peer]);
        }

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
     * Clear all messages in a conversation and remove it from the sidebar.
     * Supports per-user clear (`scope: 'me'`) and global clear (`scope: 'everyone'`).
     *
     * @param {string} conversationId
     * @param {{ scope?: 'me' | 'everyone' }} [options]
     * @returns {Promise<{
     *   conversationId: string,
     *   scope: 'me' | 'everyone',
     *   clearedAt: string,
     *   deletedMessageCount: number | null
     * }>}
     */
    clearConversation: async (conversationId, { scope = 'me' } = {}) => {
      if (!conversationId || typeof conversationId !== 'string') {
        throw new ApiError({
          code: API_ERROR_CODES.VALIDATION_ERROR,
          status: 400,
          message: 'conversationId is required to clear a conversation.',
          logged: true,
        });
      }

      const normalizedScope =
        scope === undefined || scope === null
          ? 'me'
          : String(scope).trim().toLowerCase();

      if (normalizedScope !== 'me' && normalizedScope !== 'everyone') {
        throw new ApiError({
          code: API_ERROR_CODES.VALIDATION_ERROR,
          status: 400,
          message: "scope must be 'me' or 'everyone'.",
          logged: true,
        });
      }

      const resolvedScope = /** @type {'me' | 'everyone'} */ (normalizedScope);

      localClearingIds.add(conversationId);
      update((s) => ({
        ...s,
        clearingByConversation: {
          ...(s.clearingByConversation || {}),
          [conversationId]: true,
        },
        error: null,
        errorCode: null,
      }));

      try {
        const res = await apiClearConversation(conversationId, { scope: resolvedScope });
        const clearedAt = res?.clearedAt || new Date().toISOString();
        const resultScope = res?.scope === 'everyone' ? 'everyone' : resolvedScope;

        recentlyClearedLocally.set(conversationId, Date.now());

        conversationsStore.handleConversationCleared({
          conversationId,
          scope: resultScope,
          clearedAt,
          isLocal: true,
        });

        return {
          conversationId: res?.conversationId || conversationId,
          scope: resultScope,
          clearedAt,
          deletedMessageCount: res?.deletedMessageCount ?? null,
        };
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/conversations',
          method: 'DELETE',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'clear-conversation',
          fallbackCode: PAGE_ERROR_CODES.CONVERSATION_CLEAR_FAILED,
        });
        update((s) => ({
          ...s,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      } finally {
        localClearingIds.delete(conversationId);
        update((s) => {
          const nextClearing = { ...(s.clearingByConversation || {}) };
          delete nextClearing[conversationId];
          return {
            ...s,
            clearingByConversation: nextClearing,
          };
        });
      }
    },

    /**
     * Handle a conversation clear/delete event (from local action or real-time socket broadcast).
     * Idempotent: safe to invoke multiple times for the same event.
     *
     * @param {{
     *   conversationId?: string,
     *   scope?: 'me' | 'everyone',
     *   clearedBy?: string | null,
     *   clearedAt?: string,
     *   isLocal?: boolean
     * }} payload
     */
    handleConversationCleared: (payload) => {
      const conversationId = payload?.conversationId;
      if (!conversationId) return;

      const isLocal = Boolean(payload?.isLocal || isLocallyInitiatedClear(conversationId));
      const scope = payload?.scope === 'everyone' ? 'everyone' : 'me';
      const clearedAt = payload?.clearedAt || new Date().toISOString();
      const clearedBy = payload?.clearedBy || null;

      update((s) => {
        const filtered = s.conversations.filter((c) => c.id !== conversationId);
        const isActive =
          s.activeConversationId === conversationId ||
          s.activeConversation?.id === conversationId;

        return {
          ...s,
          conversations: filtered,
          activeConversationId: isActive ? null : s.activeConversationId,
          activeConversation: isActive ? null : s.activeConversation,
          e2eeStatus: isActive ? 'initializing' : s.e2eeStatus,
          e2eeError: isActive ? null : s.e2eeError,
          keyChange: isActive ? null : s.keyChange,
          peerVerified: isActive ? false : s.peerVerified,
          peerVerifiedAt: isActive ? null : s.peerVerifiedAt,
          safetyNumber: isActive ? null : s.safetyNumber,
          lastClearedEvent: {
            conversationId,
            scope,
            clearedBy,
            clearedAt,
            isLocal,
          },
        };
      });

      if (conversationClearedHandler) {
        try {
          conversationClearedHandler(conversationId);
        } catch {
          // Non-fatal cleanup
        }
      }
    },

    /**
     * Acknowledge and clear the latest `lastClearedEvent` after the UI has handled it,
     * preventing duplicate notifications across layout remounts.
     */
    acknowledgeClearedEvent: () => {
      update((s) => (s.lastClearedEvent ? { ...s, lastClearedEvent: null } : s));
    },

    /**
     * Handle a real-time `conversation:updated` event (e.g. a new message arrived in a
     * previously cleared/hidden conversation so it should reappear in the sidebar).
     *
     * @param {{ conversationId?: string, lastMessageAt?: string }} payload
     */
    handleConversationUpdated: (payload) => {
      const conversationId = payload?.conversationId;
      if (!conversationId) return;

      const timestamp = payload?.lastMessageAt || new Date().toISOString();
      const current = get({ subscribe });
      const exists = current.conversations.some((c) => c.id === conversationId);

      if (exists) {
        update((s) => {
          const target = s.conversations.find((c) => c.id === conversationId);
          if (!target) return s;
          const rest = s.conversations.filter((c) => c.id !== conversationId);
          const refreshed = {
            ...target,
            lastMessageAt: timestamp,
            updated_at: timestamp,
          };
          return {
            ...s,
            conversations: [refreshed, ...rest],
          };
        });
      } else if (!current.loading) {
        conversationsStore.loadConversations().catch(() => {});
      }
    },

    /**
     * Apply a single real-time presence update (`user:online` / `user:offline`) to all
     * matching conversation peers and `activeConversation`. Idempotent & handles out-of-order timestamps.
     *
     * @param {{ userId?: string, isOnline?: boolean, lastSeenAt?: string | null }} payload
     */
    applyPresenceUpdate: (payload) => {
      const targetUserId = payload?.userId;
      if (!targetUserId) return;

      const nextOnline = Boolean(payload?.isOnline);
      const hasLastSeen = payload && Object.prototype.hasOwnProperty.call(payload, 'lastSeenAt');
      const incomingLastSeen = hasLastSeen ? (payload.lastSeenAt ?? null) : undefined;

      /** @param {any} peer */
      const patchPeer = (peer) => {
        if (!peer || peer.id !== targetUserId) return peer;
        let resolvedLastSeen = peer.lastSeenAt ?? peer.last_seen_at ?? null;
        if (incomingLastSeen !== undefined) {
          if (incomingLastSeen === null) {
            resolvedLastSeen = null;
          } else if (!resolvedLastSeen) {
            resolvedLastSeen = incomingLastSeen;
          } else {
            const prevMs = new Date(resolvedLastSeen).getTime();
            const nextMs = new Date(incomingLastSeen).getTime();
            if (Number.isNaN(prevMs) || (!Number.isNaN(nextMs) && nextMs >= prevMs)) {
              resolvedLastSeen = incomingLastSeen;
            }
          }
        }
        if (peer.isOnline === nextOnline && peer.lastSeenAt === resolvedLastSeen) {
          return peer;
        }
        return {
          ...peer,
          isOnline: nextOnline,
          lastSeenAt: resolvedLastSeen,
        };
      };

      update((s) => {
        let changed = false;
        const nextConversations = s.conversations.map((conv) => {
          const nextPeer = patchPeer(conv.peer);
          if (nextPeer !== conv.peer) {
            changed = true;
            return { ...conv, peer: nextPeer };
          }
          return conv;
        });

        let nextActive = s.activeConversation;
        if (s.activeConversation?.peer) {
          const patchedActivePeer = patchPeer(s.activeConversation.peer);
          if (patchedActivePeer !== s.activeConversation.peer) {
            changed = true;
            nextActive = { ...s.activeConversation, peer: patchedActivePeer };
          }
        }

        if (!changed) return s;
        return {
          ...s,
          conversations: nextConversations,
          activeConversation: nextActive,
        };
      });
    },

    /**
     * Apply a batch presence snapshot (`presence:sync`) across conversations and `activeConversation`.
     *
     * @param {Record<string, { isOnline?: boolean, lastSeenAt?: string | null }>} presenceMap
     */
    applyPresenceBatch: (presenceMap) => {
      if (!presenceMap || typeof presenceMap !== 'object') return;

      update((s) => {
        let changed = false;
        const patchConv = (conv) => {
          const peerId = conv?.peer?.id;
          if (!peerId || !Object.prototype.hasOwnProperty.call(presenceMap, peerId)) return conv;
          const entry = presenceMap[peerId];
          const nextOnline = Boolean(entry?.isOnline);
          const nextLastSeen = entry?.lastSeenAt ?? null;
          if (conv.peer.isOnline === nextOnline && conv.peer.lastSeenAt === nextLastSeen) {
            return conv;
          }
          changed = true;
          return {
            ...conv,
            peer: {
              ...conv.peer,
              isOnline: nextOnline,
              lastSeenAt: nextLastSeen,
            },
          };
        };

        const nextConversations = s.conversations.map(patchConv);
        const nextActive = s.activeConversation ? patchConv(s.activeConversation) : s.activeConversation;
        if (!changed) return s;
        return {
          ...s,
          conversations: nextConversations,
          activeConversation: nextActive,
        };
      });
    },

    /**
     * Clear live online indicators across all peers when local socket disconnects,
     * preserving each peer's known `lastSeenAt`.
     */
    markAllPeersOffline: () => {
      update((s) => {
        let changed = false;
        const nextConversations = s.conversations.map((conv) => {
          if (conv?.peer?.isOnline) {
            changed = true;
            return { ...conv, peer: { ...conv.peer, isOnline: false } };
          }
          return conv;
        });

        let nextActive = s.activeConversation;
        if (s.activeConversation?.peer?.isOnline) {
          changed = true;
          nextActive = {
            ...s.activeConversation,
            peer: { ...s.activeConversation.peer, isOnline: false },
          };
        }

        if (!changed) return s;
        return {
          ...s,
          conversations: nextConversations,
          activeConversation: nextActive,
        };
      });
    },

    /**
     * Register real-time Socket.IO listeners for conversation updates, clears, and peer presence.
     * Idempotent: cleans up any previous subscription before registering.
     * @returns {() => void}
     */
    initSocketListeners: () => {
      if (cleanupListeners) {
        cleanupListeners();
      }

      const unsubscribe = registerSocketListeners({
        onConversationCleared: (payload) => {
          if (payload?.conversationId) {
            conversationsStore.handleConversationCleared(payload);
          }
        },
        onConversationUpdated: (payload) => {
          if (payload?.conversationId) {
            conversationsStore.handleConversationUpdated(payload);
          }
        },
        onUserOnline: (payload) => {
          if (payload?.userId) {
            conversationsStore.applyPresenceUpdate({
              userId: payload.userId,
              isOnline: true,
              ...(Object.prototype.hasOwnProperty.call(payload, 'lastSeenAt')
                ? { lastSeenAt: payload.lastSeenAt }
                : {}),
            });
          }
        },
        onUserOffline: (payload) => {
          if (payload?.userId) {
            conversationsStore.applyPresenceUpdate({
              userId: payload.userId,
              isOnline: false,
              ...(Object.prototype.hasOwnProperty.call(payload, 'lastSeenAt')
                ? { lastSeenAt: payload.lastSeenAt }
                : {}),
            });
          }
        },
      });

      cleanupListeners = () => {
        unsubscribe();
        cleanupListeners = null;
      };

      return cleanupListeners;
    },

    /**
     * Update last message in conversation list when a new message arrives.
     * @param {string} conversationId
     * @param {any} message
     */
    updateLastMessage: (conversationId, message) => {
      update((s) => {
        const ts = message.created_at || new Date().toISOString();
        const updated = s.conversations.map((c) => {
          if (c.id === conversationId) {
            return {
              ...c,
              last_message: message,
              lastMessageAt: ts,
              updated_at: ts,
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
      if (cleanupListeners) {
        cleanupListeners();
      }
      localClearingIds.clear();
      recentlyClearedLocally.clear();
      set({
        ...initialState,
        pagination: { ...initialState.pagination },
        clearingByConversation: {},
      });
    },
  };

  return conversationsStore;
}

export const conversationsStore = createConversationsStore();
export const conversationStore = conversationsStore;
