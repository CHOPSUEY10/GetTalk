import { query } from '../config/database.js';

export async function create({ messageId, userId, status }) {
  const result = await query(
    `INSERT INTO message_receipts (message_id, user_id, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id, status) DO NOTHING
     RETURNING id`,
    [messageId, userId, status]
  );
  return result.rows[0] || null;
}

export async function findByMessage(messageId) {
  const result = await query(
    `SELECT user_id AS "userId", status, created_at AS "createdAt"
     FROM message_receipts WHERE message_id = $1`,
    [messageId]
  );
  return result.rows;
}
