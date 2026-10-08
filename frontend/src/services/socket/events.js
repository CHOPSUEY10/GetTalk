/**
 * Socket.IO event constants for frontend (rule §19).
 * Centralized constant names preventing string typos across components.
 */

// Client -> Server
export const CONVERSATION_JOIN = 'conversation:join';
export const CONVERSATION_LEAVE = 'conversation:leave';

export const MESSAGE_SEND = 'message:send';
export const MESSAGE_EDIT = 'message:edit';
export const MESSAGE_DELETE = 'message:delete';

export const MESSAGE_DELIVERED = 'message:delivered';
export const MESSAGE_READ = 'message:read';

// Server -> Client
export const MESSAGE_NEW = 'message:new';
export const MESSAGE_UPDATED = 'message:updated';
export const MESSAGE_DELETED = 'message:deleted';

export const CONVERSATION_UPDATED = 'conversation:updated';

export const FRIEND_REQUEST = 'friend:request';
export const FRIEND_ACCEPTED = 'friend:accepted';

export const USER_ONLINE = 'user:online';
export const USER_OFFLINE = 'user:offline';
