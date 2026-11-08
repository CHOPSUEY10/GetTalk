import { writable } from 'svelte/store';
import { socket, joinConversation as apiJoin, leaveConversation as apiLeave } from '../services/socket/client.js';
import { friendsStore } from './friends.store.js';
import { uiStore } from './ui.store.js';
import { API_ERROR_CODES, handleApiError } from '../lib/errors/apierror.js';
import { PAGE_ERROR_CODES, getPageErrorMessage } from '../lib/errors/pageerror.js';

export const SOCKET_QUOTA_NOTIFICATION_ID = 'socket-connection-limit';

/**
 * @typedef {Object} SocketState
 * @property {'disconnected' | 'connecting' | 'connected' | 'error'} status
 * @property {boolean} connected
 * @property {string | null} id
 * @property {string | null} activeConversationId
 * @property {string[]} joinedRooms
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
  error: null,
  errorCode: null,
  errorMessage: null
};

function createSocketStore() {
  const { subscribe, set, update } = writable(initialState);

  // Sync with native socket lifecycle events
  socket.on('connect', () => {
    uiStore.dismissNotification(SOCKET_QUOTA_NOTIFICATION_ID);

    update((state) => ({
      ...state,
      status: 'connected',
      connected: true,
      id: socket.id || null,
      error: null,
      errorCode: null,
      errorMessage: null
    }));

    // Register real-time listeners globally so friends and notifications
    // update instantly without requiring a page reload (Issue a)
    friendsStore.initSocketListeners();
    friendsStore.loadAll();
  });

  socket.on('disconnect', () => {
    update((state) => {
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
          joinedRooms: []
        };
      }

      return {
        ...state,
        status: 'disconnected',
        connected: false,
        id: null,
        activeConversationId: null,
        joinedRooms: [],
        error: null,
        errorCode: null,
        errorMessage: null
      };
    });
  });

  socket.on('connect_error', (err) => {
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
        method: 'SOCKET'
      });

      const userMessage = getPageErrorMessage(PAGE_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED);

      update((state) => ({
        ...state,
        status: 'error',
        connected: false,
        id: null,
        error: API_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED,
        errorCode: API_ERROR_CODES.MAX_CONCURRENT_SOCKETS_EXCEEDED,
        errorMessage: userMessage
      }));

      uiStore.notify({
        id: SOCKET_QUOTA_NOTIFICATION_ID,
        type: 'warning',
        message: userMessage,
        timeout: 8000
      });
      return;
    }

    const normalized = handleApiError(err, {
      code: rawCode || API_ERROR_CODES.NETWORK_ERROR,
      endpoint: 'socket:connect',
      method: 'SOCKET'
    });
    const userMessage = getPageErrorMessage(normalized.code);

    update((state) => ({
      ...state,
      status: 'error',
      connected: false,
      id: null,
      error: userMessage,
      errorCode: normalized.code,
      errorMessage: userMessage
    }));
  });

  socket.on('reconnect_attempt', () => {
    update((state) => ({
      ...state,
      status: 'connecting'
    }));
  });

  const connectSocket = () => {
    if (!socket.connected) {
      if (socket.io?.opts) {
        socket.io.opts.reconnection = true;
      }
      uiStore.dismissNotification(SOCKET_QUOTA_NOTIFICATION_ID);
      update((state) => ({
        ...state,
        status: 'connecting',
        error: null,
        errorCode: null,
        errorMessage: null
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
      if (socket.io?.opts) {
        socket.io.opts.reconnection = true;
      }
      if (socket.connected) {
        socket.disconnect();
      }
      uiStore.dismissNotification(SOCKET_QUOTA_NOTIFICATION_ID);
      set(initialState);
    },
    /**
     * Join conversation room
     * @param {string} conversationId
     * @returns {Promise<{ success?: boolean, error?: string, code?: string }>}
     */
    joinRoom: async (conversationId) => {
      if (!conversationId) {
        return {
          success: false,
          error: 'conversationId is required',
          code: API_ERROR_CODES.VALIDATION_ERROR
        };
      }

      const res = await apiJoin(conversationId);
      if (res?.success) {
        update((state) => ({
          ...state,
          activeConversationId: conversationId,
          joinedRooms: Array.from(new Set([...state.joinedRooms, conversationId]))
        }));
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
        activeConversationId: state.activeConversationId === conversationId ? null : state.activeConversationId,
        joinedRooms: state.joinedRooms.filter((r) => r !== conversationId)
      }));
    }
  };
}

export const socketStore = createSocketStore();
export { socket };
