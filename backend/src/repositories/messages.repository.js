import { query } from '../config/database.js';
import { UUID_REGEX } from '../validators/pagination.validator.js';

export async function findByConversation(conversationId, { limit = 50, before } = {}) {
  let sql = `
    SELECT m.id, m.conversation_id AS "conversationId",
           m.sender_id AS "senderId",
           m.body_ciphertext AS "bodyCiphertext",
           m.nonce,
           m.client_message_id AS "clientMessageId",
           m.created_at AS "createdAt",
           m.edited_at AS "editedAt",
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', a.id,
               'messageId', a.message_id,
               'sizeBytes', a.size_bytes,
               'metadataCiphertext', a.metadata_ciphertext,
               'metadataNonce', a.metadata_nonce,
               'createdAt', a.created_at
             ) ORDER BY a.created_at)
             FROM attachments a
             WHERE a.message_id = m.id AND a.deleted_at IS NULL
           ), '[]'::json) AS attachments
    FROM messages m
    WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
  `;
  const params = [conversationId];

  if (before) {
    if (UUID_REGEX.test(before)) {
      // Keyset pagination on (created_at, id): messages sharing a timestamp are
      // neither skipped nor duplicated. The cursor must belong to the same
      // conversation, so a foreign message id cannot be used as a probe; an
      // unknown cursor simply yields an empty page.
      sql += ` AND (m.created_at, m.id) < (
                 SELECT c.created_at, c.id FROM messages c
                 WHERE c.id = $${params.length + 1} AND c.conversation_id = $1
               )`;
      params.push(before);
    } else {
      sql += ` AND m.created_at < $${params.length + 1}::timestamptz`;
      params.push(before);
    }
  }

  sql += ` ORDER BY m.created_at DESC, m.id DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await query(sql, params);
  return result.rows;
}

export async function findById(messageId) {
  const result = await query(
    `SELECT id, conversation_id, sender_id,
            body_ciphertext, nonce, client_message_id,
            created_at, edited_at, deleted_at
     FROM messages WHERE id = $1`,
    [messageId]
  );
  return result.rows[0] || null;
}

export async function create({ conversationId, senderId, bodyCiphertext, nonce, clientMessageId }) {
  const result = await query(
    `INSERT INTO messages (conversation_id, sender_id, body_ciphertext, nonce, client_message_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, conversation_id AS "conversationId",
               sender_id AS "senderId",
               body_ciphertext AS "bodyCiphertext",
               nonce,
               client_message_id AS "clientMessageId",
               created_at AS "createdAt",
               '[]'::json AS "attachments"`,
    [conversationId, senderId, bodyCiphertext, nonce, clientMessageId || null]
  );
  return result.rows[0];
}

export async function update(messageId, { bodyCiphertext, nonce }) {
  const result = await query(
    `UPDATE messages
     SET body_ciphertext = $1, nonce = $2, edited_at = NOW()
     WHERE id = $3 AND deleted_at IS NULL
     RETURNING id,
               conversation_id AS "conversationId",
               sender_id AS "senderId",
               body_ciphertext AS "bodyCiphertext",
               nonce,
               client_message_id AS "clientMessageId",
               created_at AS "createdAt",
               edited_at AS "editedAt"`,
    [bodyCiphertext, nonce, messageId]
  );
  return result.rows[0] || null;
}

export async function softDelete(messageId) {
  const result = await query(
    `UPDATE messages
     SET deleted_at = NOW()
     WHERE id = $1
     RETURNING id,
               conversation_id AS "conversationId",
               deleted_at AS "deletedAt"`,
    [messageId]
  );
  return result.rows[0] || null;
}
