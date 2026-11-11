import { PAGE_ERROR_CODES } from './errors/pageerror.js';

/**
 * Maximum plaintext message payload size: 10 KB (10,240 UTF-8 bytes) per Rule #26.
 */
export const MAX_MESSAGE_TEXT_BYTES = 10 * 1024;

/**
 * Maximum attachment file size before encryption: 25 MB per Rule #21 & #26.
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_NICKNAME_LENGTH = 60;
export const MAX_BIO_LENGTH = 160;

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,50}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSCODE_REGEX = /^\d{4,8}$/;

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

/**
 * Validate profile update fields (`username`, `nickname`, `bio`).
 * @param {{ username?: string, nickname?: string | null, bio?: string | null }} input
 */
export function validateProfileInput({ username, nickname, bio } = {}) {
  if (username !== undefined) {
    if (typeof username !== 'string' || !USERNAME_REGEX.test(username.trim())) {
      return {
        valid: false,
        code: PAGE_ERROR_CODES.INVALID_USERNAME_FORMAT,
      };
    }
  }

  if (nickname !== undefined && nickname !== null) {
    if (typeof nickname !== 'string' || nickname.trim().length > MAX_NICKNAME_LENGTH) {
      return {
        valid: false,
        code: PAGE_ERROR_CODES.NICKNAME_TOO_LONG,
      };
    }
  }

  if (bio !== undefined && bio !== null) {
    if (typeof bio !== 'string' || bio.trim().length > MAX_BIO_LENGTH) {
      return {
        valid: false,
        code: PAGE_ERROR_CODES.BIO_TOO_LONG,
      };
    }
  }

  return { valid: true, code: null };
}

/**
 * Validate password change fields before submitting to API.
 */
export function validatePasswordChangeInput({
  currentPassword,
  newPassword,
  confirmPassword,
  mfaEnabled = false,
  mfaCode = '',
} = {}) {
  if (!currentPassword || !newPassword || !confirmPassword) {
    return { valid: false, code: PAGE_ERROR_CODES.REQUIRED_FIELDS };
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return { valid: false, code: PAGE_ERROR_CODES.PASSWORD_TOO_SHORT };
  }

  if (newPassword !== confirmPassword) {
    return { valid: false, code: PAGE_ERROR_CODES.PASSWORD_MISMATCH };
  }

  if (newPassword === currentPassword) {
    return { valid: false, code: PAGE_ERROR_CODES.PASSWORD_SAME_AS_CURRENT };
  }

  if (mfaEnabled) {
    const trimmedCode = String(mfaCode || '').trim();
    if (!trimmedCode) {
      return { valid: false, code: PAGE_ERROR_CODES.MFA_CODE_REQUIRED };
    }
  }

  return { valid: true, code: null };
}

/**
 * Validate email change request input (`newEmail` and `currentPassword`).
 */
export function validateEmailChangeRequestInput({ newEmail, currentPassword } = {}) {
  if (!newEmail || !String(newEmail).trim()) {
    return { valid: false, code: PAGE_ERROR_CODES.EMAIL_REQUIRED };
  }

  if (!EMAIL_REGEX.test(String(newEmail).trim())) {
    return { valid: false, code: PAGE_ERROR_CODES.INVALID_EMAIL_FORMAT };
  }

  if (!currentPassword) {
    return { valid: false, code: PAGE_ERROR_CODES.REQUIRED_FIELDS };
  }

  return { valid: true, code: null };
}

/**
 * Validate 6-digit email change OTP input.
 */
export function validateEmailChangeVerifyInput(input = {}) {
  const raw =
    typeof input === 'string'
      ? input
      : input?.otp ?? input?.token ?? input?.code ?? '';
  const trimmed = String(raw || '').trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return { valid: false, code: PAGE_ERROR_CODES.INVALID_OTP_CODE };
  }
  return { valid: true, code: null };
}

/**
 * Validate 4-8 digit local App Passcode Lock PIN.
 */
export function validatePasscodeInput(passcode, confirmPasscode = undefined) {
  const trimmed = String(passcode || '').trim();
  if (!PASSCODE_REGEX.test(trimmed)) {
    return { valid: false, code: PAGE_ERROR_CODES.PASSCODE_INVALID };
  }
  if (confirmPasscode !== undefined && String(confirmPasscode || '').trim() !== trimmed) {
    return { valid: false, code: PAGE_ERROR_CODES.PASSWORD_MISMATCH };
  }
  return { valid: true, code: null };
}

export default {
  MAX_MESSAGE_TEXT_BYTES,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_NICKNAME_LENGTH,
  MAX_BIO_LENGTH,
  getUtf8ByteLength,
  validateMessageText,
  validateAttachmentFile,
  validateProfileInput,
  validatePasswordChangeInput,
  validateEmailChangeRequestInput,
  validateEmailChangeVerifyInput,
  validatePasscodeInput,
};
