/**
 * Centralized error code constants.
 *
 * Use these instead of hard-coding strings throughout the codebase
 * so error codes stay consistent and easy to refactor.
 */

// ── Authentication ─────────────────────────────────────────────
export const UNAUTHORIZED = 'UNAUTHORIZED';
export const INVALID_CREDENTIALS = 'INVALID_CREDENTIALS';
export const SESSION_EXPIRED = 'SESSION_EXPIRED';

// ── Authorization ──────────────────────────────────────────────
export const FORBIDDEN = 'FORBIDDEN';
export const NOT_CONVERSATION_MEMBER = 'NOT_CONVERSATION_MEMBER';
export const NOT_MESSAGE_OWNER = 'NOT_MESSAGE_OWNER';

// ── Validation ─────────────────────────────────────────────────
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const BAD_REQUEST = 'BAD_REQUEST';
export const UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY';

// ── Resource ───────────────────────────────────────────────────
export const RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND';
export const USER_NOT_FOUND = 'USER_NOT_FOUND';
export const CONVERSATION_NOT_FOUND = 'CONVERSATION_NOT_FOUND';
export const MESSAGE_NOT_FOUND = 'MESSAGE_NOT_FOUND';

// ── Conflict ───────────────────────────────────────────────────
export const CONFLICT = 'CONFLICT';
export const USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS';
export const FRIENDSHIP_ALREADY_EXISTS = 'FRIENDSHIP_ALREADY_EXISTS';

// ── Rate Limiting ──────────────────────────────────────────────
export const TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS';

// ── Server ─────────────────────────────────────────────────────
export const INTERNAL_ERROR = 'INTERNAL_ERROR';

// ── Route ──────────────────────────────────────────────────────
export const ROUTE_NOT_FOUND = 'ROUTE_NOT_FOUND';
export const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED';
