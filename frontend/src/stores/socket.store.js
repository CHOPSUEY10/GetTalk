import { writable } from 'svelte/store';
import { socket, joinConversation as apiJoin, leaveConversation as apiLeave } from '../services/socket/client.js';
import { friendsStore } from './friends.store.js';
import { API_ERROR_CODES, handleApiError } from '../errors/apierror.js';
import { getPageErrorMessage } from '../errors/pageerror.js';

/**
 * @typedef {Object} SocketState
 * @property {'disconnected' | 'connecting' | 'connected' | 'error'} status
 * @property {boolean} connected
 * @property {string | null} id
 * @property {string | null} activeConversationId
 * @property {string[]} joinedRooms
 * @property {string | null} error
 * @property {string | null} [errorCode]
 */

/** @type {SocketState} */
const initialState = {
  status: 'disconnected',
  connected: false,
  id: null,
  activeConversationId: null,
  joinedRooms: [],
  error: null,
  errorCode: null
};

function createSocketStore() {
  const { subscribe, set, update } = writable(initialState);

  // Sync with native socket lifecycle events
  socket.on('connect', () => {
    update((state) => ({
      ...state,
      status: 'connected',
      connected: true,
      id: socket.id || null,
      error: null,
      errorCode: null
    }));

    // Register real-time listeners globally so friends and notifications
    // update instantly without requiring a page reload (Issue a)
    friendsStore.initSocketListeners();
    friendsStore.loadAll();
  });

  socket.on('disconnect', () => {
    update((state) => ({
      ...state,
      status: 'disconnected',
      connected: false,
      id: null,
      activeConversationId: null,
      joinedRooms: [],
      error: null,
      errorCode: null
    }));
  });

  socket.on('connect_error', (err) => {
    const normalized = handleApiError(err, {
      code: API_ERROR_CODES.NETWORK_ERROR,
      endpoint: 'socket:connect',
      method: 'SOCKET'
    });
    update((state) => ({
      ...state,
      status: 'error',
      connected: false,
      id: null,
      error: getPageErrorMessage(normalized.code),
      errorCode: normalized.code
    }));
  });

  socket.on('reconnect_attempt', () => {
    update((state) => ({
      ...state,
      status: 'connecting'
    }));
  });

  return {
    subscribe,
    connect: () => {
      if (!socket.connected) {
        update((state) => ({ ...state, status: 'connecting', error: null, errorCode: null }));
        socket.connect();
      }
    },
    disconnect: () => {
      if (socket.connected) {
        socket.disconnect();
      }
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
