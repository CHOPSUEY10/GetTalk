import { query } from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Security Events Repository
 * Audit logging for critical authentication and security actions.
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
