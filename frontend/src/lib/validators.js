import { PAGE_ERROR_CODES } from './errors/pageerror.js';

/**
 * Maximum plaintext message payload size: 10 KB (10,240 UTF-8 bytes) per Rule #26.
 */
export const MAX_MESSAGE_TEXT_BYTES = 10 * 1024;

/**
 * Maximum attachment file size before encryption: 25 MB per Rule #21 & #26.
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

const utf8Encoder = new TextEncoder();

/**
 * Compute the UTF-8 byte length of a string.
 *
 * @param {string | null | undefined} text
 * @returns {number}
 */
export function getUtf8ByteLength(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return utf8Encoder.encode(text).byteLength;
}

/**
 * Validate plaintext message content before encryption (send or edit).
 * Enforces non-empty text and UTF-8 byte length <= 10 KB (10,240 bytes).
 *
 * @param {any} text
 * @returns {{
 *   valid: boolean,
 *   code: string | null,
 *   errorCode: string | null,
 *   byteLength: number,
 *   trimmed: string
 * }}
 */
export function validateMessageText(text) {
  if (typeof text !== 'string') {
    return {
      valid: false,
      code: PAGE_ERROR_CODES.EMPTY_MESSAGE,
      errorCode: PAGE_ERROR_CODES.EMPTY_MESSAGE,
      byteLength: 0,
      trimmed: '',
    };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return {
      valid: false,
      code: PAGE_ERROR_CODES.EMPTY_MESSAGE,
      errorCode: PAGE_ERROR_CODES.EMPTY_MESSAGE,
      byteLength: 0,
      trimmed: '',
    };
  }

  const trimmedByteLength = getUtf8ByteLength(trimmed);
  const rawByteLength = getUtf8ByteLength(text);
  const effectiveByteLength = Math.max(trimmedByteLength, rawByteLength);

  if (effectiveByteLength > MAX_MESSAGE_TEXT_BYTES) {
    return {
      valid: false,
      code: PAGE_ERROR_CODES.MESSAGE_TOO_LONG,
      errorCode: PAGE_ERROR_CODES.MESSAGE_TOO_LONG,
      byteLength: effectiveByteLength,
      trimmed,
    };
  }

  return {
    valid: true,
    code: null,
    errorCode: null,
    byteLength: trimmedByteLength,
    trimmed,
  };
}

/**
 * Validate an attachment file before client-side encryption (Rule #21 & #26).
 * Enforces size <= 25 MB and valid MIME type format.
 *
 * @param {any} file
 * @returns {{
 *   valid: boolean,
 *   code: string | null,
 *   errorCode: string | null,
 *   mimeType: string
 * }}
 */
export function validateAttachmentFile(file) {
  if (!file || typeof file.size !== 'number' || file.size <= 0) {
    return {
      valid: false,
      code: PAGE_ERROR_CODES.VALIDATION_ERROR,
      errorCode: PAGE_ERROR_CODES.VALIDATION_ERROR,
      mimeType: 'application/octet-stream',
    };
  }

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      valid: false,
      code: PAGE_ERROR_CODES.FILE_TOO_LARGE,
      errorCode: PAGE_ERROR_CODES.FILE_TOO_LARGE,
      mimeType: typeof file.type === 'string' && file.type ? file.type : 'application/octet-stream',
    };
  }

  const rawType = typeof file.type === 'string' ? file.type.trim() : '';
  const mimeType = rawType || 'application/octet-stream';

  // Reject malformed MIME strings containing control characters
  if (/[\r\n\0]/.test(mimeType)) {
    return {
      valid: false,
      code: PAGE_ERROR_CODES.VALIDATION_ERROR,
      errorCode: PAGE_ERROR_CODES.VALIDATION_ERROR,
      mimeType: 'application/octet-stream',
    };
  }

  return {
    valid: true,
    code: null,
    errorCode: null,
    mimeType,
  };
}

export default {
  MAX_MESSAGE_TEXT_BYTES,
  MAX_ATTACHMENT_SIZE_BYTES,
  getUtf8ByteLength,
  validateMessageText,
  validateAttachmentFile,
};
