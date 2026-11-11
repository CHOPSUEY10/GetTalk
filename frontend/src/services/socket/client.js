import { io } from 'socket.io-client';
import env from '../../config/env.js';
import * as events from './events.js';

export const SOCKET_RECONNECTION_ATTEMPTS = 5;
export const SOCKET_RECONNECTION_DELAY_MS = 1000;
export const SOCKET_RECONNECTION_DELAY_MAX_MS = 5000;

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
  reconnectionDelayMax: SOCKET_RECONNECTION_DELAY_MAX_MS
});

/**
 * Join a specific conversation room on the server.
 * @param {string} conversationId
 * @returns {Promise<{ success?: boolean, error?: string }>}
 */
export function joinConversation(conversationId) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ error: 'Socket is not connected' });
      return;
    }

    socket.emit(events.CONVERSATION_JOIN, { conversationId }, (response) => {
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
