import env from '../../config/env.js';
import { api, ApiError } from './client.js';

/**
 * Resolve a pre-signed URL returned by the backend:
 * - Relative paths (`/api/storage/:token` for local driver) are prefixed with `env.apiUrl`.
 * - Absolute URLs (`https://...` for S3 / MinIO / Supabase Storage) are used as-is.
 *
 * @param {string} url
 * @returns {string}
 */
function resolvePresignedUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `${env.apiUrl}${url}`;
}

/**
 * Request a short-lived pre-signed PUT URL for uploading an encrypted attachment.
 *
 * @param {{
 *   messageId: string,
 *   metadataCiphertext: string,
 *   metadataNonce: string,
 *   sizeBytes: number
 * }} payload
 * @returns {Promise<{
 *   attachment: any,
 *   upload: { url: string, method: string, headers: Record<string, string>, expiresAt: string }
 * }>}
 */
export const presignAttachmentUpload = ({
  messageId,
  metadataCiphertext,
  metadataNonce,
  sizeBytes,
}) => {
  return api.post('/api/attachments/presign', {
    messageId,
    metadataCiphertext,
    metadataNonce,
    sizeBytes,
  });
};

/**
 * Finalize a pre-signed upload after the encrypted bytes have been PUT.
 *
 * @param {string} attachmentId
 * @param {{ messageId?: string }} [payload]
 * @returns {Promise<{ attachment: any }>}
 */
export const completeAttachmentUpload = (attachmentId, payload = {}) => {
  return api.post(`/api/attachments/${encodeURIComponent(attachmentId)}/complete`, payload);
};

/**
 * Request a short-lived pre-signed GET URL for downloading an encrypted attachment.
 *
 * @param {string} attachmentId
 * @returns {Promise<{ url: string, expiresAt: string }>}
 */
export const getAttachmentDownloadUrl = (attachmentId) => {
  return api.get(`/api/attachments/${encodeURIComponent(attachmentId)}/url`);
};

/**
 * Upload encrypted attachment bytes + metadata via the pre-signed URL flow:
 *   1. POST /api/attachments/presign
 *   2. PUT  <upload.url>
 *   3. POST /api/attachments/:id/complete
 *
 * @param {{
 *   messageId: string,
 *   metadataCiphertext: string,
 *   metadataNonce: string,
 *   encryptedBlob: Blob | ArrayBuffer | Uint8Array
 * }} payload
 * @returns {Promise<{ attachment: any }>}
 */
export const uploadAttachment = async ({
  messageId,
  metadataCiphertext,
  metadataNonce,
  encryptedBlob,
}) => {
  const sizeBytes =
    encryptedBlob instanceof Blob
      ? encryptedBlob.size
      : encryptedBlob.byteLength;

  const { attachment, upload: uploadTarget } = await presignAttachmentUpload({
    messageId,
    metadataCiphertext,
    metadataNonce,
    sizeBytes,
  });

  const body = ArrayBuffer.isView(encryptedBlob)
    ? /** @type {ArrayBuffer} */ (encryptedBlob.buffer)
    : encryptedBlob;

  const putRes = await fetch(resolvePresignedUrl(uploadTarget.url), {
    method: uploadTarget.method || 'PUT',
    headers: uploadTarget.headers || { 'Content-Type': 'application/octet-stream' },
    body,
  });

  if (!putRes.ok) {
    throw new ApiError(putRes.status, 'Failed to upload encrypted attachment to storage.');
  }

  return completeAttachmentUpload(attachment.id, { messageId });
};

/**
 * Download the encrypted attachment bytes via a short-lived pre-signed GET URL.
 *
 * @param {string} attachmentId
 * @returns {Promise<ArrayBuffer>}
 */
export const downloadAttachmentContent = async (attachmentId) => {
  const { url } = await getAttachmentDownloadUrl(attachmentId);
  const res = await fetch(resolvePresignedUrl(url), { method: 'GET' });

  if (!res.ok) {
    throw new ApiError(res.status, 'Failed to download encrypted attachment.');
  }

  return res.arrayBuffer();
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
