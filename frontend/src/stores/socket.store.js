import { writable } from 'svelte/store';
import { socket, joinConversation as apiJoin, leaveConversation as apiLeave } from '../services/socket/client.js';

/**
 * @typedef {Object} SocketState
 * @property {'disconnected' | 'connecting' | 'connected' | 'error'} status
 * @property {boolean} connected
 * @property {string | null} id
 * @property {string | null} activeConversationId
 * @property {string[]} joinedRooms
 * @property {string | null} error
 */

/** @type {SocketState} */
const initialState = {
  status: 'disconnected',
  connected: false,
  id: null,
  activeConversationId: null,
  joinedRooms: [],
  error: null
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
      error: null
    }));
  });

  socket.on('disconnect', () => {
    update((state) => ({
      ...state,
      status: 'disconnected',
      connected: false,
      id: null,
      activeConversationId: null,
      joinedRooms: [],
      error: null
    }));
  });

  socket.on('connect_error', (err) => {
    update((state) => ({
      ...state,
      status: 'error',
      connected: false,
      id: null,
      error: err?.message || 'Socket connection error'
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
        update((state) => ({ ...state, status: 'connecting', error: null }));
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
     */
    joinRoom: async (conversationId) => {
      if (!conversationId) return { error: 'conversationId is required' };

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
