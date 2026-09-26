import { query, getClient } from '../config/database.js';

export async function findAllByUserId(userId) {
  const result = await query(
    `SELECT c.id, c.type, c.created_at,
            c.updated_at AS "lastMessageAt"
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE cm.user_id = $1
     ORDER BY c.updated_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function findById(conversationId) {
  const result = await query(
    'SELECT id, type, created_at, updated_at FROM conversations WHERE id = $1',
    [conversationId]
  );
  return result.rows[0] || null;
}

export async function isMember(userId, conversationId) {
  const result = await query(
    `SELECT 1 FROM conversation_members
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  return result.rows.length > 0;
}

export async function getMembers(conversationId) {
  const result = await query(
    `SELECT u.id, u.username
     FROM conversation_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id = $1`,
    [conversationId]
  );
  return result.rows;
}

/**
 * Find existing direct conversation between two users.
 */
export async function findDirectBetween(userA, userB) {
  const result = await query(
    `SELECT c.id, c.type, c.created_at
     FROM conversations c
     WHERE c.type = 'direct'
       AND EXISTS (
         SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = $1
       )
       AND EXISTS (
         SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = $2
       )`,
    [userA, userB]
  );
  return result.rows[0] || null;
}

export async function create(type, memberIds) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const convResult = await client.query(
      `INSERT INTO conversations (type) VALUES ($1) RETURNING id, type, created_at`,
      [type]
    );
    const conv = convResult.rows[0];

    for (const userId of memberIds) {
      await client.query(
        'INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)',
        [conv.id, userId]
      );
    }

    await client.query('COMMIT');
    return conv;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateTimestamp(conversationId) {
  await query(
    'UPDATE conversations SET updated_at = NOW() WHERE id = $1',
    [conversationId]
  );
}
