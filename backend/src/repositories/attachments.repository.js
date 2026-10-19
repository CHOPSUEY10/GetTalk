import { query } from '../config/database.js';

export async function create({ messageId, uploaderId, storageKey, metadataCiphertext, metadataNonce, sizeBytes }) {
  const result = await query(
    `INSERT INTO attachments (message_id, uploader_id, storage_key, metadata_ciphertext, metadata_nonce, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, message_id AS "messageId", size_bytes AS "sizeBytes",
               metadata_ciphertext AS "metadataCiphertext",
               metadata_nonce AS "metadataNonce", created_at AS "createdAt"`,
    [messageId, uploaderId, storageKey, metadataCiphertext, metadataNonce, sizeBytes]
  );
  return result.rows[0];
}

export async function findById(attachmentId) {
  const result = await query(
    `SELECT id, message_id, uploader_id, storage_key,
            metadata_ciphertext, metadata_nonce, size_bytes, created_at, deleted_at
     FROM attachments WHERE id = $1 AND deleted_at IS NULL`,
    [attachmentId]
  );
  return result.rows[0] || null;
}

export async function softDelete(attachmentId) {
  await query(
    'UPDATE attachments SET deleted_at = NOW() WHERE id = $1',
    [attachmentId]
  );
}
