import { query } from '../config/database.js';
import logger from '../utils/logger.js';
import { MAX_PAGE_LIMIT, UUID_REGEX } from '../validators/pagination.validator.js';

/**
 * Security Events Repository
 * Audit logging for critical authentication and security actions.
 * Collective queries enforce strict pagination bounds (Rule #9).
 */

/**
 * Record a security event in the database.
 * Never store plaintext passwords, secrets, or raw cryptographic tokens in metadata.
 * @param {{ userId?: string | null, eventType: string, ipAddress?: string | null, metadata?: Record<string, any> | null }} param0
 */
export async function create({ userId = null, eventType, ipAddress = null, metadata = null }) {
  try {
    const result = await query(
      `INSERT INTO security_events (user_id, event_type, ip_address, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, event_type, ip_address, created_at`,
      [userId, eventType, ipAddress, metadata ? JSON.stringify(metadata) : null]
    );
    return result.rows[0];
  } catch (err) {
    logger.error('Failed to log security event', { eventType, error: err.message });
    return null;
  }
}

/**
 * List security events for a user with strict cursor/limit quota (Rule #9).
 *
 * @param {string} userId
 * @param {{ limit?: number, before?: string | null }} [options]
 */
export async function findByUserId(userId, { limit = 20, before = null } = {}) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), MAX_PAGE_LIMIT + 1);
  const params = [userId];
  let cursorSql = '';

  if (before) {
    params.push(before);
    if (UUID_REGEX.test(before)) {
      cursorSql = `AND (created_at, id) < (
                     SELECT c.created_at, c.id
                     FROM security_events c
                     WHERE c.id = $${params.length} AND c.user_id = $1
                   )`;
    } else {
      cursorSql = `AND created_at < $${params.length}::timestamptz`;
    }
  }

  params.push(safeLimit);

  const result = await query(
    `SELECT id, user_id AS "userId", event_type AS "eventType",
            ip_address AS "ipAddress", metadata, created_at AS "createdAt"
     FROM security_events
     WHERE user_id = $1
       ${cursorSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}
