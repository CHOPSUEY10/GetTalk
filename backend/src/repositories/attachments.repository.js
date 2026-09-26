import { query } from '../config/database.js';

export async function create({ messageId, uploaderId, storageKey, originalName, mimeType, sizeBytes, checksum }) {
  const result = await query(
    `INSERT INTO attachments (message_id, uploader_id, storage_key, original_name, mime_type, size_bytes, checksum)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, storage_key AS "storageKey", original_name AS "originalName",
               mime_type AS "mimeType", size_bytes AS "sizeBytes", created_at AS "createdAt"`,
    [messageId || null, uploaderId, storageKey, originalName, mimeType, sizeBytes, checksum || null]
  );
  return result.rows[0];
}

export async function findById(attachmentId) {
  const result = await query(
    `SELECT id, message_id, uploader_id, storage_key,
            original_name, mime_type, size_bytes, checksum, created_at, deleted_at
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
