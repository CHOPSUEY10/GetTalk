import { query, getClient } from '../config/database.js';
import { UUID_REGEX } from '../validators/pagination.validator.js';

/**
 * Conversations of a user, most recent activity first, keyset-paginated on
 * (updated_at, id). The direct-chat peer is resolved in the same query to
 * avoid an N+1 lookup per conversation.
 *
 * @param {string} userId
 * @param {{ limit?: number, before?: string | null }} [options]
 *   `limit` is the number of rows to fetch (callers pass page size + 1).
 */
export async function findAllByUserId(userId, { limit = 21, before = null } = {}) {
  const params = [userId];
  let cursorSql = '';

  if (before) {
    params.push(before);
    if (UUID_REGEX.test(before)) {
      // The cursor must be a conversation the user belongs to.
      cursorSql = `AND (c.updated_at, c.id) < (
                     SELECT cc.updated_at, cc.id
                     FROM conversations cc
                     JOIN conversation_members ccm
                       ON ccm.conversation_id = cc.id AND ccm.user_id = $1
                     WHERE cc.id = $${params.length}
                   )`;
    } else {
      cursorSql = `AND c.updated_at < $${params.length}::timestamptz`;
    }
  }

  params.push(limit);

  const result = await query(
    `SELECT c.id, c.type, c.created_at,
            c.updated_at AS "lastMessageAt",
            peer.id AS "peerId",
            peer.username AS "peerUsername",
            peer.nickname AS "peerNickname",
            peer.bio AS "peerBio",
            peer.last_seen_at AS "peerLastSeenAt"
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id
     LEFT JOIN LATERAL (
       SELECT u.id, u.username, u.nickname, u.bio, u.last_seen_at
       FROM conversation_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.conversation_id = c.id AND pm.user_id <> $1
       ORDER BY pm.user_id
       LIMIT 1
     ) peer ON TRUE
     WHERE cm.user_id = $1
     ${cursorSql}
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT $${params.length}`,
    params
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
    `SELECT u.id, u.username, u.nickname, u.bio, u.last_seen_at
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
