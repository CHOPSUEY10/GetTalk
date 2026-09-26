/**
 * Socket.IO room naming conventions.
 *
 * Centralised so room names are consistent across
 * handlers, middleware, and any future pub/sub layer.
 */

/**
 * Room name for a conversation.
 * @param {string} conversationId
 * @returns {string}
 */
export function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

/**
 * Room name for a user's personal channel (e.g. friend notifications).
 * @param {string} userId
 * @returns {string}
 */
export function userRoom(userId) {
  return `user:${userId}`;
}
