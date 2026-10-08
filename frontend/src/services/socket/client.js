import { io } from 'socket.io-client';
import env from '../../config/env.js';
import * as events from './events.js';

/**
 * Managed Socket.IO client instance (rule §18).
 */
export const socket = io(env.socketUrl, {
  autoConnect: false,
  withCredentials: true,
  transports: ['websocket', 'polling']
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
 * @returns {Promise<{ success?: boolean, message?: any, error?: string }>}
 */
export function sendEncryptedMessage(payload) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ error: 'Socket is not connected' });
      return;
    }

    socket.emit(events.MESSAGE_SEND, payload, (response) => {
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
