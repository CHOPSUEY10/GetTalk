import { io } from 'socket.io-client';
import env from '../../config/env.js';
import * as events from './events.js';
import { isBrowserDocumentActive } from '../../lib/presence.js';

export const SOCKET_RECONNECTION_ATTEMPTS = 5;
export const SOCKET_RECONNECTION_DELAY_MS = 1000;
export const SOCKET_RECONNECTION_DELAY_MAX_MS = 5000;

/**
 * Notify the application when the backend rejects a Socket.IO operation with SERVICE_UNAVAILABLE (503).
 * @param {any} response
 */
function notifyIfServiceUnavailable(response) {
  if (
    response?.code === 'SERVICE_UNAVAILABLE' &&
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function'
  ) {
    window.dispatchEvent(
      new CustomEvent('api:service-unavailable', {
        detail: { endpoint: 'socket', method: 'SOCKET', status: 503 },
      })
    );
  }
}

/**
 * Managed singleton Socket.IO client instance (Rule #18).
 * Never create additional Socket.IO instances inside components.
 */
export const socket = io(env.socketUrl, {
  autoConnect: false,
  withCredentials: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: SOCKET_RECONNECTION_ATTEMPTS,
  reconnectionDelay: SOCKET_RECONNECTION_DELAY_MS,
  reconnectionDelayMax: SOCKET_RECONNECTION_DELAY_MAX_MS,
  auth: (cb) => {
    cb({ active: isBrowserDocumentActive() });
  },
});

/**
 * Join a specific conversation room on the server.
 * @param {string} conversationId
 * @returns {Promise<{ success?: boolean, error?: string, code?: string }>}
 */
export function joinConversation(conversationId) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ error: 'Socket is not connected' });
      return;
    }

    socket.emit(events.CONVERSATION_JOIN, { conversationId }, (response) => {
      notifyIfServiceUnavailable(response);
      resolve(response || { success: true });
    });
  });
}

/**
 * Leave a specific conversation room on the server.
 * @param {string} conversationId
 */
export function leaveConversation(conversationId) {
  if (socket.connected) {
    socket.emit(events.CONVERSATION_LEAVE, { conversationId });
  }
}

/**
 * Send encrypted message payload to server room.
 * @param {{ conversationId: string, bodyCiphertext: string, nonce: string, clientMessageId?: string }} payload
 * @returns {Promise<{ success?: boolean, message?: any, error?: string, code?: string, disconnected?: boolean }>}
 */
export function sendEncryptedMessage(payload) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ error: 'Socket is not connected', disconnected: true });
      return;
    }

    socket.emit(events.MESSAGE_SEND, payload, (response) => {
      notifyIfServiceUnavailable(response);
      resolve(response || { success: true });
    });
  });
}

/**
 * Edit an existing message via Socket.IO (FR-11).
 * @param {{ messageId: string, bodyCiphertext: string, nonce: string }} payload
 * @returns {Promise<{ success?: boolean, message?: any, error?: string, code?: string, disconnected?: boolean }>}
 */
export function editEncryptedMessage(payload) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ error: 'Socket is not connected', disconnected: true });
      return;
    }

    socket.emit(events.MESSAGE_EDIT, payload, (response) => {
      notifyIfServiceUnavailable(response);
      resolve(response || { success: true });
    });
  });
}

/**
 * Soft-delete an existing message via Socket.IO (FR-12).
 * @param {{ messageId: string }} payload
 * @returns {Promise<{ success?: boolean, deletedAt?: string, error?: string, code?: string, disconnected?: boolean }>}
 */
export function deleteEncryptedMessage(payload) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ error: 'Socket is not connected', disconnected: true });
      return;
    }

    socket.emit(events.MESSAGE_DELETE, payload, (response) => {
      notifyIfServiceUnavailable(response);
      resolve(response || { success: true });
    });
  });
}

/**
 * Mark a message as delivered.
 * @param {string} messageId
 */
export function markMessageDelivered(messageId) {
  if (socket.connected) {
    socket.emit(events.MESSAGE_DELIVERED, { messageId });
  }
}

/**
 * Mark a message as read.
 * @param {string} messageId
 */
export function markMessageRead(messageId) {
  if (socket.connected) {
    socket.emit(events.MESSAGE_READ, { messageId });
  }
}

/**
 * Emit typing start indicator to a conversation room.
 * @param {string} conversationId
 */
export function emitTypingStart(conversationId) {
  if (socket.connected && conversationId) {
    socket.emit(events.TYPING_START, { conversationId });
  }
}

/**
 * Emit typing stop indicator to a conversation room.
 * @param {string} conversationId
 */
export function emitTypingStop(conversationId) {
  if (socket.connected && conversationId) {
    socket.emit(events.TYPING_STOP, { conversationId });
  }
}

/**
 * Inform the backend that this browser tab / session transitioned to active or inactive.
 * @param {boolean} active
 * @returns {Promise<{ success?: boolean, isOnline?: boolean, lastSeenAt?: string | null, error?: string }>}
 */
export function emitPresenceUpdate(active) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ success: false, error: 'Socket is not connected' });
      return;
    }

    socket.emit(events.PRESENCE_UPDATE, { active: Boolean(active) }, (response) => {
      resolve(response || { success: true });
    });
  });
}

/**
 * Send a lightweight active presence heartbeat to refresh the Redis lease.
 * @param {boolean} [active=true]
 */
export function emitPresenceHeartbeat(active = true) {
  if (socket.connected) {
    socket.emit(events.PRESENCE_HEARTBEAT, { active: Boolean(active) });
  }
}

/**
 * Request the authoritative Redis-backed presence snapshot for a set of user IDs.
 * @param {string[]} userIds
 * @returns {Promise<{ success?: boolean, presence?: Record<string, { isOnline: boolean, lastSeenAt: string | null }>, error?: string }>}
 */
export function syncPresence(userIds) {
  return new Promise((resolve) => {
    const uniqueIds = Array.from(new Set((userIds || []).filter(Boolean)));
    if (!socket.connected || uniqueIds.length === 0) {
      resolve({ success: false, presence: {} });
      return;
    }

    socket.emit(events.PRESENCE_SYNC, { userIds: uniqueIds }, (response) => {
      resolve(response || { success: true, presence: {} });
    });
  });
}
