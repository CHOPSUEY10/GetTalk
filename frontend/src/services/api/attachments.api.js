import { api } from './client.js';

/**
 * Upload encrypted attachment metadata (issues #14, #15; API contract §10).
 *
 * The backend stores opaque ciphertext only. Plaintext filename/MIME/checksum
 * fields are rejected by the validator.
 *
 * @param {{
 *   messageId: string,
 *   sizeBytes: number,
 *   metadataCiphertext: string,
 *   metadataNonce: string
 * }} payload
 * @returns {Promise<{ attachment: any }>}
 */
export const uploadAttachment = (payload) => {
  return api.post('/api/attachments', payload);
};

/**
 * Get attachment details by ID.
 *
 * @param {string} attachmentId
 * @returns {Promise<{ attachment: any }>}
 */
export const getAttachment = (attachmentId) => {
  return api.get(`/api/attachments/${attachmentId}`);
};

/**
 * Remove an attachment by ID.
 *
 * @param {string} attachmentId
 * @returns {Promise<void>}
 */
export const deleteAttachment = (attachmentId) => {
  return api.delete(`/api/attachments/${attachmentId}`);
};

// Aliases for convenience
export const upload = uploadAttachment;
export const getById = getAttachment;
export const remove = deleteAttachment;
