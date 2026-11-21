import { writable, get } from 'svelte/store';
import {
  socket,
  joinConversation as apiJoin,
  leaveConversation as apiLeave,
  emitPresenceUpdate,
  emitPresenceHeartbeat,
  syncPresence as apiSyncPresence,
} from '../services/socket/client.js';
import * as events from '../services/socket/events.js';
import {
  friendsStore,
  registerFriendsPresenceSeedHandler,
} from './friends.store.js';
import {
  conversationsStore,
  registerConversationsPresenceSeedHandler,
} from './conversations.store.js';
import { userStore } from './user.store.js';
import { uiStore } from './ui.store.js';
import {
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  PRESENCE_IDLE_TIMEOUT_MS,
  isBrowserDocumentActive,
} from '../lib/presence.js';
import { API_ERROR_CODES, handleApiError } from '../lib/errors/apierror.js';
import { PAGE_ERROR_CODES, getPageErrorMessage } from '../lib/errors/pageerror.js';

export const SOCKET_QUOTA_NOTIFICATION_ID = 'socket-connection-limit';

/**
 * @typedef {Object} PresenceEntry
 * @property {boolean} isOnline
 * @property {string | null} lastSeenAt
 */

/**
 * @typedef {Object} SocketState
 * @property {'disconnected' | 'connecting' | 'connected' | 'error'} status
 * @property {boolean} connected
 * @property {string | null} id
 * @property {string | null} activeConversationId
 * @property {string[]} joinedRooms
 * @property {Record<string, PresenceEntry>} presenceByUserId
 * @property {boolean} selfActive
 * @property {string | null} selfLastSeenAt
 * @property {string | null} error
 * @property {string | null} [errorCode]
 * @property {string | null} [errorMessage]
 */

/** @type {SocketState} */
const initialState = {
  status: 'disconnected',
  connected: false,
  id: null,
  activeConversationId: null,
  joinedRooms: [],
  presenceByUserId: {},
  selfActive: isBrowserDocumentActive(),
  selfLastSeenAt: null,
  error: null,
  errorCode: null,
  errorMessage: null,
};

/**
 * Merge a single user's presence update while handling duplicate and out-of-order timestamps.
 *
 * @param {Record<string, PresenceEntry>} currentMap
 * @param {string} userId
 * @param {boolean} isOnline
 * @param {boolean} hasLastSeen
 * @param {string | null | undefined} incomingLastSeen
 * @returns {Record<string, PresenceEntry>}
 */
function mergePresenceMap(currentMap, userId, isOnline, hasLastSeen, incomingLastSeen) {
  const existing = currentMap[userId];
  let resolvedLastSeen = existing?.lastSeenAt ?? null;

  if (hasLastSeen) {
    if (incomingLastSeen === null) {
      resolvedLastSeen = null;
    } else if (incomingLastSeen) {
      if (!resolvedLastSeen) {
        resolvedLastSeen = incomingLastSeen;
      } else {
        const prevMs = new Date(resolvedLastSeen).getTime();
        const nextMs = new Date(incomingLastSeen).getTime();
        if (Number.isNaN(prevMs) || (!Number.isNaN(nextMs) && nextMs >= prevMs)) {
          resolvedLastSeen = incomingLastSeen;
        }
      }
    }
  }

  if (existing && existing.isOnline === isOnline && existing.lastSeenAt === resolvedLastSeen) {
    return currentMap;
  }

  return {
    ...currentMap,
    [userId]: {
      isOnline,
      lastSeenAt: resolvedLastSeen,
    },
  };
}

/**
 * Mark all cached presence entries offline while retaining each user's known `lastSeenAt`.
 *
 * @param {Record<string, PresenceEntry>} currentMap
 * @returns {Record<string, PresenceEntry>}
 */
function markPresenceMapOffline(currentMap) {
  const entries = Object.entries(currentMap || {});
  if (entries.length === 0) return currentMap || {};

  let changed = false;
  /** @type {Record<string, PresenceEntry>} */
  const next = {};
  for (const [uid, entry] of entries) {
    if (entry?.isOnline) {
      changed = true;
      next[uid] = { isOnline: false, lastSeenAt: entry.lastSeenAt ?? null };
    } else {
      next[uid] = entry;
    }
  }
  return changed ? next : currentMap;
}

function createSocketStore() {
  const internalStore = writable({ ...initialState, presenceByUserId: {} });
  const { subscribe, set, update } = internalStore;

  /** @type {ReturnType<typeof setInterval> | null} */
  let heartbeatTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let idleTimer = null;
  /** @type {(() => void) | null} */
  let cleanupBrowserListeners = null;
  let lastActivityBumpMs = 0;
  let wasAppLocked = false;

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const stopIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    if (!socket.connected) return;
    heartbeatTimer = setInterval(() => {
      const state = get(internalStore);
      if (socket.connected && state.selfActive && isBrowserDocumentActive()) {
        emitPresenceHeartbeat(true);
      } else {
        stopHeartbeat();
      }
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);

    if (typeof heartbeatTimer?.unref === 'function') {
      heartbeatTimer.unref();
    }
  };

  const resetIdleTimer = () => {
    stopIdleTimer();
    if (typeof window === 'undefined' || !socket.connected) return;
    if (!isBrowserDocumentActive()) return;

    idleTimer = setTimeout(() => {
      setLocalActivity(false);
    }, PRESENCE_IDLE_TIMEOUT_MS);

    if (typeof idleTimer?.unref === 'function') {
      idleTimer.unref();
    }
  };

  const collectKnownPeerIds = () => {
    /** @type {Set<string>} */
    const ids = new Set();
    const convState = get(conversationsStore);
    for (const conv of convState.conversations || []) {
      if (conv?.peer?.id) ids.add(conv.peer.id);
    }
    if (convState.activeConversation?.peer?.id) {
      ids.add(convState.activeConversation.peer.id);
    }

    const friendState = get(friendsStore);
    for (const friend of friendState.friends || []) {
      const fId = friend?.userId || friend?.id;
      if (fId) ids.add(fId);
    }

    const sockState = get(internalStore);
    for (const uid of Object.keys(sockState.presenceByUserId || {})) {
      ids.add(uid);
    }

    const selfId = get(userStore)?.id;
    if (selfId) ids.add(selfId);

    return Array.from(ids);
  };

  /**
   * Request fresh Redis-backed presence snapshot from backend and synchronize stores.
   * @param {string[]} userIds
   */
  const syncPresenceForUsers = async (userIds) => {
    const uniqueIds = Array.from(new Set((userIds || []).filter(Boolean)));
    if (!socket.connected || uniqueIds.length === 0) return {};

    const res = await apiSyncPresence(uniqueIds);
    const presence = res?.presence;
    if (!presence || typeof presence !== 'object') return {};

    const selfId = get(userStore)?.id;
    update((state) => {
      let nextMap = state.presenceByUserId;
      let nextSelfLastSeen = state.selfLastSeenAt;

      for (const [uid, entry] of Object.entries(presence)) {
        nextMap = mergePresenceMap(
          nextMap,
          uid,
          Boolean(entry?.isOnline),
          true,
          entry?.lastSeenAt ?? null
        );
        if (selfId && uid === selfId && entry?.lastSeenAt) {
          nextSelfLastSeen = entry.lastSeenAt;
        }
      }

      return {
        ...state,
        presenceByUserId: nextMap,
        selfLastSeenAt: nextSelfLastSeen,
      };
    });

    conversationsStore.applyPresenceBatch(presence);
    friendsStore.applyPresenceBatch(presence);
    return presence;
  };

  const syncKnownPeers = () => {
    const ids = collectKnownPeerIds();
    if (ids.length > 0 && socket.connected) {
      syncPresenceForUsers(ids).catch(() => { });
    }
  };

  /**
   * Transition this client's active presence state (foreground/visible vs hidden/idle/locked).
   * @param {boolean} active
   */
  const setLocalActivity = async (active) => {
    const isLocked = Boolean(get(userStore)?.appLock?.locked);
    const nextActive = Boolean(active) && !isLocked && isBrowserDocumentActive();
    const nowIso = new Date().toISOString();

    const prevState = get(internalStore);
    if (!nextActive) {
      stopHeartbeat();
      stopIdleTimer();
    }

    update((state) => ({
      ...state,
      selfActive: nextActive,
      selfLastSeenAt: !nextActive ? nowIso : state.selfLastSeenAt,
    }));

    if (socket.connected) {
      const ack = await emitPresenceUpdate(nextActive);
      if (ack?.lastSeenAt) {
        update((state) => ({
          ...state,
          selfLastSeenAt: ack.lastSeenAt,
        }));
      }
      if (nextActive) {
        startHeartbeat();
        resetIdleTimer();
        if (!prevState.selfActive) {
          syncKnownPeers();
        }
      }
    }
  };

  const detachBrowserPresenceListeners = () => {
    if (cleanupBrowserListeners) {
      cleanupBrowserListeners();
      cleanupBrowserListeners = null;
    }
  };

  const attachBrowserPresenceListeners = () => {
    if (cleanupBrowserListeners) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setLocalActivity(false);
      } else {
        setLocalActivity(true);
      }
    };

    const handlePageExit = () => {
      stopHeartbeat();
      stopIdleTimer();
      if (socket.connected) {
        emitPresenceUpdate(false);
      }
    };

    const handleNetworkOffline = () => {
      stopHeartbeat();
      stopIdleTimer();
      const nowIso = new Date().toISOString();
      update((state) => ({
        ...state,
        selfActive: false,
        selfLastSeenAt: nowIso,
        presenceByUserId: markPresenceMapOffline(state.presenceByUserId),
      }));
      conversationsStore.markAllPeersOffline();
      friendsStore.markAllFriendsOffline();
    };

    const handleNetworkOnline = () => {
      if (socket.connected) {
        setLocalActivity(isBrowserDocumentActive());
        syncKnownPeers();
      } else {
        const st = get(internalStore);
        if (st.errorCode !== API_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED) {
          connectSocket();
        }
      }
    };

    const handleUserActivity = () => {
      const now = Date.now();
      if (now - lastActivityBumpMs < 1000) return;
      lastActivityBumpMs = now;

      if (!isBrowserDocumentActive() || !socket.connected) return;

      const state = get(internalStore);
      if (!state.selfActive) {
        setLocalActivity(true);
      } else {
        resetIdleTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageExit);
    window.addEventListener('beforeunload', handlePageExit);
    window.addEventListener('offline', handleNetworkOffline);
    window.addEventListener('online', handleNetworkOnline);
    window.addEventListener('focus', handleUserActivity);
    window.addEventListener('pointerdown', handleUserActivity, { passive: true });
    window.addEventListener('keydown', handleUserActivity, { passive: true });
    window.addEventListener('touchstart', handleUserActivity, { passive: true });

    cleanupBrowserListeners = () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageExit);
      window.removeEventListener('beforeunload', handlePageExit);
      window.removeEventListener('offline', handleNetworkOffline);
      window.removeEventListener('online', handleNetworkOnline);
      window.removeEventListener('focus', handleUserActivity);
      window.removeEventListener('pointerdown', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
    };
  };

  // Sync local activity when App Lock engages/disengages
  userStore.subscribe((uState) => {
    const locked = Boolean(uState?.appLock?.locked);
    if (locked === wasAppLocked) return;
    wasAppLocked = locked;
    if (!socket.connected) return;
    setLocalActivity(!locked && isBrowserDocumentActive());
  });

  // Listen to authoritative presence events from server
  const handlePresenceEvent = (isOnline) => (payload) => {
    const targetUserId = payload?.userId;
    if (!targetUserId) return;

    const hasLastSeen = Object.prototype.hasOwnProperty.call(payload, 'lastSeenAt');
    const incomingLastSeen = hasLastSeen ? (payload.lastSeenAt ?? null) : undefined;
    const selfId = get(userStore)?.id;

    update((state) => {
      const nextMap = mergePresenceMap(
        state.presenceByUserId,
        targetUserId,
        isOnline,
        hasLastSeen,
        incomingLastSeen
      );

      let nextSelfLastSeen = state.selfLastSeenAt;
      if (selfId && targetUserId === selfId && hasLastSeen && incomingLastSeen) {
        nextSelfLastSeen = incomingLastSeen;
      }

      if (nextMap === state.presenceByUserId && nextSelfLastSeen === state.selfLastSeenAt) {
        return state;
      }

      return {
        ...state,
        presenceByUserId: nextMap,
        selfLastSeenAt: nextSelfLastSeen,
      };
    });
  };

  socket.on(events.USER_ONLINE, handlePresenceEvent(true));
  socket.on(events.USER_OFFLINE, handlePresenceEvent(false));

  // Sync with native socket lifecycle events
  socket.on('connect', () => {
    uiStore.dismissNotification(SOCKET_QUOTA_NOTIFICATION_ID);

    const activeNow = isBrowserDocumentActive() && !Boolean(get(userStore)?.appLock?.locked);

    update((state) => ({
      ...state,
      status: 'connected',
      connected: true,
      id: socket.id || null,
      selfActive: activeNow,
      error: null,
      errorCode: null,
      errorMessage: null,
    }));

    // Register real-time listeners globally so friends, conversations, and presence
    // update instantly without requiring a page reload
    friendsStore.initSocketListeners();
    conversationsStore.initSocketListeners();
    attachBrowserPresenceListeners();

    emitPresenceUpdate(activeNow).catch(() => { });
    if (activeNow) {
      startHeartbeat();
      resetIdleTimer();
    } else {
      stopHeartbeat();
      stopIdleTimer();
    }

    friendsStore.loadAll();
    syncKnownPeers();
  });

  socket.on('disconnect', () => {
    stopHeartbeat();
    stopIdleTimer();
    const nowIso = new Date().toISOString();

    update((state) => {
      const offlineMap = markPresenceMapOffline(state.presenceByUserId);

      // Preserve quota exceeded error state when disconnect() is invoked to halt reconnection
      if (
        state.error === API_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED ||
        state.errorCode === API_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED
      ) {
        return {
          ...state,
          connected: false,
          id: null,
          activeConversationId: null,
          joinedRooms: [],
          selfActive: false,
          selfLastSeenAt: nowIso,
          presenceByUserId: offlineMap,
        };
      }

      return {
        ...state,
        status: 'disconnected',
        connected: false,
        id: null,
        activeConversationId: null,
        joinedRooms: [],
        selfActive: false,
        selfLastSeenAt: nowIso,
        presenceByUserId: offlineMap,
        error: null,
        errorCode: null,
        errorMessage: null,
      };
    });

    conversationsStore.markAllPeersOffline();
    friendsStore.markAllFriendsOffline();
  });

  socket.on('connect_error', (err) => {
    stopHeartbeat();
    stopIdleTimer();

    const rawCode =
      err?.data?.code ||
      err?.data?.error?.code ||
      err?.code ||
      null;

    if (rawCode === API_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED) {
      // Immediately halt auto-reconnection to prevent connection storm/flood (Rule #18)
      if (socket.io?.opts) {
        socket.io.opts.reconnection = false;
      }
      socket.disconnect();

      handleApiError(err, {
        code: API_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED,
        endpoint: 'socket:connect',
        method: 'SOCKET',
      });

      const userMessage = getPageErrorMessage(PAGE_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED);

      update((state) => ({
        ...state,
        status: 'error',
        connected: false,
        id: null,
        selfActive: false,
        presenceByUserId: markPresenceMapOffline(state.presenceByUserId),
        error: API_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED,
        errorCode: API_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED,
        errorMessage: userMessage,
      }));

      uiStore.notify({
        id: SOCKET_QUOTA_NOTIFICATION_ID,
        type: 'warning',
        message: userMessage,
        timeout: 8000,
      });
      return;
    }

    const normalized = handleApiError(err, {
      code: rawCode || API_ERROR_CODES.NETWORK_ERROR,
      endpoint: 'socket:connect',
      method: 'SOCKET',
    });
    const userMessage = getPageErrorMessage(normalized.code);

    update((state) => ({
      ...state,
      status: 'error',
      connected: false,
      id: null,
      selfActive: false,
      presenceByUserId: markPresenceMapOffline(state.presenceByUserId),
      error: userMessage,
      errorCode: normalized.code,
      errorMessage: userMessage,
    }));
  });

  socket.on('reconnect_attempt', () => {
    update((state) => ({
      ...state,
      status: 'connecting',
    }));
  });

  const connectSocket = () => {
    if (!socket.connected) {
      if (socket.io?.opts) {
        socket.io.opts.reconnection = true;
      }
      uiStore.dismissNotification(SOCKET_QUOTA_NOTIFICATION_ID);
      attachBrowserPresenceListeners();
      update((state) => ({
        ...state,
        status: 'connecting',
        error: null,
        errorCode: null,
        errorMessage: null,
      }));
      socket.connect();
    }
  };

  return {
    subscribe,
    connect: connectSocket,
    /**
     * Manually re-initiate WebSocket connection (e.g. after closing other active tabs).
     */
    reconnect: () => {
      if (socket.connected) {
        socket.disconnect();
      }
      connectSocket();
    },
    disconnect: () => {
      stopHeartbeat();
      stopIdleTimer();
      detachBrowserPresenceListeners();

      if (socket.io?.opts) {
        socket.io.opts.reconnection = true;
      }
      if (socket.connected) {
        emitPresenceUpdate(false);
        socket.disconnect();
      }
      uiStore.dismissNotification(SOCKET_QUOTA_NOTIFICATION_ID);
      set({
        ...initialState,
        selfActive: false,
        presenceByUserId: {},
      });
    },
    /**
     * Seed authoritative presence entries from REST responses (conversations/friends/profile).
     * @param {Array<{ userId?: string, id?: string, isOnline?: boolean, lastSeenAt?: string | null }>} entries
     */
    seedPresence: (entries) => {
      if (!Array.isArray(entries) || entries.length === 0) return;
      update((state) => {
        let nextMap = state.presenceByUserId;
        for (const item of entries) {
          const uid = item?.userId || item?.id;
          if (!uid) continue;
          const hasOnline = Object.prototype.hasOwnProperty.call(item, 'isOnline');
          const hasLastSeen = Object.prototype.hasOwnProperty.call(item, 'lastSeenAt');
          if (!hasOnline && !hasLastSeen) continue;
          const existing = nextMap[uid];
          const nextOnline = hasOnline ? Boolean(item.isOnline) : Boolean(existing?.isOnline);
          const nextLastSeen = hasLastSeen ? (item.lastSeenAt ?? null) : (existing?.lastSeenAt ?? null);
          if (existing && existing.isOnline === nextOnline && existing.lastSeenAt === nextLastSeen) {
            continue;
          }
          nextMap = {
            ...nextMap,
            [uid]: {
              isOnline: nextOnline,
              lastSeenAt: nextLastSeen,
            },
          };
        }
        return nextMap === state.presenceByUserId
          ? state
          : { ...state, presenceByUserId: nextMap };
      });
    },
    /**
     * Request fresh Redis-backed presence for specific user IDs via Socket.IO.
     * @param {string[]} userIds
     */
    syncPresence: syncPresenceForUsers,
    /**
     * Explicitly transition local active state (foreground/visible vs hidden/idle/locked).
     * @param {boolean} active
     */
    setLocalActivity,
    /**
     * Join conversation room and hydrate peer presence from server ack when available.
     * @param {string} conversationId
     * @returns {Promise<{ success?: boolean, peerPresence?: any, error?: string, code?: string }>}
     */
    joinRoom: async (conversationId) => {
      if (!conversationId) {
        return {
          success: false,
          error: 'conversationId is required',
          code: API_ERROR_CODES.VALIDATION_ERROR,
        };
      }

      const res = await apiJoin(conversationId);
      if (res?.success) {
        update((state) => {
          let nextMap = state.presenceByUserId;
          if (res?.peerPresence?.userId) {
            nextMap = mergePresenceMap(
              nextMap,
              res.peerPresence.userId,
              Boolean(res.peerPresence.isOnline),
              true,
              res.peerPresence.lastSeenAt ?? null
            );
          }
          return {
            ...state,
            activeConversationId: conversationId,
            joinedRooms: Array.from(new Set([...state.joinedRooms, conversationId])),
            presenceByUserId: nextMap,
          };
        });

        if (res?.peerPresence?.userId) {
          conversationsStore.applyPresenceUpdate(res.peerPresence);
          friendsStore.applyPresenceUpdate(res.peerPresence);
        }
      }
      return res;
    },
    /**
     * Leave conversation room
     * @param {string} conversationId
     */
    leaveRoom: (conversationId) => {
      if (!conversationId) return;

      apiLeave(conversationId);
      update((state) => ({
        ...state,
        activeConversationId:
          state.activeConversationId === conversationId ? null : state.activeConversationId,
        joinedRooms: state.joinedRooms.filter((r) => r !== conversationId),
      }));
    },
  };
}

export const socketStore = createSocketStore();
registerConversationsPresenceSeedHandler((entries) => socketStore.seedPresence(entries));
registerFriendsPresenceSeedHandler((entries) => socketStore.seedPresence(entries));
export { socket };
