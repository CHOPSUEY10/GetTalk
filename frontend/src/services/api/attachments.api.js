import { api } from './client.js';

/**
 * Upload encrypted attachment bytes + metadata (issues #14, #15).
 *
 * @param {{
 *   messageId: string,
 *   metadataCiphertext: string,
 *   metadataNonce: string,
 *   encryptedBlob: Blob
 * }} payload
 * @returns {Promise<{ attachment: any }>}
 */
export const uploadAttachment = ({
  messageId,
  metadataCiphertext,
  metadataNonce,
  encryptedBlob,
}) => {
  return api.postBinary('/api/attachments', encryptedBlob, {
    'X-Message-Id': messageId,
    'X-Metadata-Ciphertext': metadataCiphertext,
    'X-Metadata-Nonce': metadataNonce,
  });
};

/**
 * Download the encrypted attachment bytes.
 *
 * @param {string} attachmentId
 * @returns {Promise<ArrayBuffer>}
 */
export const downloadAttachmentContent = (attachmentId) => {
  return api.getBinary(`/api/attachments/${encodeURIComponent(attachmentId)}/content`);
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
