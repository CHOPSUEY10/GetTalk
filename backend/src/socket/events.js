/**
 * Socket.IO event constants (plan §15, rule §20).
 *
 * All event names are centralised here so they are never
 * duplicated as string literals throughout the application.
 */

// ── Client → Server ────────────────────────────────────────────
export const CONVERSATION_JOIN   = 'conversation:join';
export const CONVERSATION_LEAVE  = 'conversation:leave';

export const MESSAGE_SEND        = 'message:send';
export const MESSAGE_EDIT        = 'message:edit';
export const MESSAGE_DELETE      = 'message:delete';

export const MESSAGE_DELIVERED   = 'message:delivered';
export const MESSAGE_READ        = 'message:read';

// ── Server → Client ───────────────────────────────────────────
export const MESSAGE_NEW         = 'message:new';
export const MESSAGE_UPDATED     = 'message:updated';
export const MESSAGE_DELETED     = 'message:deleted';

// Re-used bi-directionally
// MESSAGE_DELIVERED and MESSAGE_READ are listed above

export const CONVERSATION_UPDATED = 'conversation:updated';

export const FRIEND_REQUEST      = 'friend:request';
export const FRIEND_ACCEPTED     = 'friend:accepted';

export const USER_ONLINE         = 'user:online';
export const USER_OFFLINE        = 'user:offline';
