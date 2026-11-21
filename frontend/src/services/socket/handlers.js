import { socket } from './client.js';
import * as events from './events.js';

/**
 * Register incoming socket event listeners.
 * @param {{
 *   onNewMessage?: (payload: { message: any }) => void,
 *   onMessageUpdated?: (payload: { message?: any, messageId?: string, message_id?: string, conversationId?: string, bodyCiphertext?: string, nonce?: string, updatedAt?: string }) => void,
 *   onMessageDeleted?: (payload: { messageId?: string, message_id?: string, conversationId?: string, deletedAt?: string }) => void,
 *   onMessageDelivered?: (payload: { messageId: string }) => void,
 *   onMessageRead?: (payload: { messageId: string }) => void,
 *   onAttachmentNew?: (payload: { attachment: any }) => void,
 *   onConversationUpdated?: (payload: { conversationId: string, lastMessageAt?: string }) => void,
 *   onConversationCleared?: (payload: { conversationId: string, scope?: 'me' | 'everyone', clearedBy?: string, clearedAt?: string }) => void,
 *   onFriendRequest?: (payload: any) => void,
 *   onFriendAccepted?: (payload: any) => void,
 *   onTypingStart?: (payload: any) => void,
 *   onTypingStop?: (payload: any) => void,
 *   onUserOnline?: (payload: { userId: string, isOnline?: boolean, lastSeenAt?: string | null }) => void,
 *   onUserOffline?: (payload: { userId: string, isOnline?: boolean, lastSeenAt?: string | null }) => void
 * }} callbacks
 * @returns {() => void} Cleanup function to unsubscribe listeners
 */
export function registerSocketListeners(callbacks) {
  const handlers = [];

  if (callbacks.onNewMessage) {
    socket.on(events.MESSAGE_NEW, callbacks.onNewMessage);
    handlers.push(() => socket.off(events.MESSAGE_NEW, callbacks.onNewMessage));
  }

  if (callbacks.onMessageUpdated) {
    socket.on(events.MESSAGE_UPDATED, callbacks.onMessageUpdated);
    handlers.push(() => socket.off(events.MESSAGE_UPDATED, callbacks.onMessageUpdated));
  }

  if (callbacks.onMessageDeleted) {
    socket.on(events.MESSAGE_DELETED, callbacks.onMessageDeleted);
    handlers.push(() => socket.off(events.MESSAGE_DELETED, callbacks.onMessageDeleted));
  }

  if (callbacks.onMessageDelivered) {
    socket.on(events.MESSAGE_DELIVERED, callbacks.onMessageDelivered);
    handlers.push(() => socket.off(events.MESSAGE_DELIVERED, callbacks.onMessageDelivered));
  }

  if (callbacks.onMessageRead) {
    socket.on(events.MESSAGE_READ, callbacks.onMessageRead);
    handlers.push(() => socket.off(events.MESSAGE_READ, callbacks.onMessageRead));
  }

  if (callbacks.onAttachmentNew) {
    socket.on(events.ATTACHMENT_NEW, callbacks.onAttachmentNew);
    handlers.push(() => socket.off(events.ATTACHMENT_NEW, callbacks.onAttachmentNew));
  }

  if (callbacks.onConversationUpdated) {
    socket.on(events.CONVERSATION_UPDATED, callbacks.onConversationUpdated);
    handlers.push(() => socket.off(events.CONVERSATION_UPDATED, callbacks.onConversationUpdated));
  }

  if (callbacks.onConversationCleared) {
    socket.on(events.CONVERSATION_CLEARED, callbacks.onConversationCleared);
    handlers.push(() => socket.off(events.CONVERSATION_CLEARED, callbacks.onConversationCleared));
  }

  if (callbacks.onFriendRequest) {
    socket.on(events.FRIEND_REQUEST, callbacks.onFriendRequest);
    handlers.push(() => socket.off(events.FRIEND_REQUEST, callbacks.onFriendRequest));
  }

  if (callbacks.onFriendAccepted) {
    socket.on(events.FRIEND_ACCEPTED, callbacks.onFriendAccepted);
    handlers.push(() => socket.off(events.FRIEND_ACCEPTED, callbacks.onFriendAccepted));
  }

  if (callbacks.onTypingStart) {
    socket.on(events.TYPING_START, callbacks.onTypingStart);
    handlers.push(() => socket.off(events.TYPING_START, callbacks.onTypingStart));
  }

  if (callbacks.onTypingStop) {
    socket.on(events.TYPING_STOP, callbacks.onTypingStop);
    handlers.push(() => socket.off(events.TYPING_STOP, callbacks.onTypingStop));
  }

  if (callbacks.onUserOnline) {
    socket.on(events.USER_ONLINE, callbacks.onUserOnline);
    handlers.push(() => socket.off(events.USER_ONLINE, callbacks.onUserOnline));
  }

  if (callbacks.onUserOffline) {
    socket.on(events.USER_OFFLINE, callbacks.onUserOffline);
    handlers.push(() => socket.off(events.USER_OFFLINE, callbacks.onUserOffline));
  }

  // Return unsubscribe function
  return () => {
    handlers.forEach((cleanup) => cleanup());
  };
}
