import { socket } from './client.js';
import * as events from './events.js';

/**
 * Register incoming socket event listeners.
 * @param {{
 *   onNewMessage?: (payload: { message: any }) => void,
 *   onMessageUpdated?: (payload: { message: any }) => void,
 *   onMessageDeleted?: (payload: { messageId: string }) => void,
 *   onMessageDelivered?: (payload: { messageId: string }) => void,
 *   onMessageRead?: (payload: { messageId: string }) => void,
 *   onFriendRequest?: (payload: any) => void,
 *   onFriendAccepted?: (payload: any) => void
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

  if (callbacks.onFriendRequest) {
    socket.on(events.FRIEND_REQUEST, callbacks.onFriendRequest);
    handlers.push(() => socket.off(events.FRIEND_REQUEST, callbacks.onFriendRequest));
  }

  if (callbacks.onFriendAccepted) {
    socket.on(events.FRIEND_ACCEPTED, callbacks.onFriendAccepted);
    handlers.push(() => socket.off(events.FRIEND_ACCEPTED, callbacks.onFriendAccepted));
  }

  // Return unsubscribe function
  return () => {
    handlers.forEach((cleanup) => cleanup());
  };
}
