import { API_ERROR_CODES } from './apierror.js';
import { ENCRYPTION_ERROR_CODES } from './encryptionerror.js';

/**
 * Consolidated error codes recognized by the presentation layer (`pageerror`).
 */
export const PAGE_ERROR_CODES = Object.freeze({
  ...API_ERROR_CODES,
  ...ENCRYPTION_ERROR_CODES,

  // Store & page operation codes
  MESSAGE_SEND_FAILED: 'MESSAGE_SEND_FAILED',
  MESSAGE_EDIT_FAILED: 'MESSAGE_EDIT_FAILED',
  MESSAGE_DELETE_FAILED: 'MESSAGE_DELETE_FAILED',
  MESSAGE_LOAD_FAILED: 'MESSAGE_LOAD_FAILED',
  CONVERSATION_LOAD_FAILED: 'CONVERSATION_LOAD_FAILED',
  CONVERSATION_CREATE_FAILED: 'CONVERSATION_CREATE_FAILED',
  FRIENDS_LOAD_FAILED: 'FRIENDS_LOAD_FAILED',
  FRIEND_REQUEST_FAILED: 'FRIEND_REQUEST_FAILED',
  FRIEND_ACCEPT_FAILED: 'FRIEND_ACCEPT_FAILED',
  FRIEND_REJECT_FAILED: 'FRIEND_REJECT_FAILED',
  FRIEND_REMOVE_FAILED: 'FRIEND_REMOVE_FAILED',
  MFA_STATUS_LOAD_FAILED: 'MFA_STATUS_LOAD_FAILED',
  MFA_SETUP_FAILED: 'MFA_SETUP_FAILED',
  MFA_DISABLE_FAILED: 'MFA_DISABLE_FAILED',
  OTP_SEND_FAILED: 'OTP_SEND_FAILED',
  OTP_VERIFY_FAILED: 'OTP_VERIFY_FAILED',
  E2EE_PEER_UNAVAILABLE: 'E2EE_PEER_UNAVAILABLE',
  E2EE_NOT_READY: 'E2EE_NOT_READY',
  OPERATION_BUSY: 'OPERATION_BUSY',

  // Client-side input validation codes
  REQUIRED_FIELDS: 'REQUIRED_FIELDS',
  LOGIN_REQUIRED_FIELDS: 'LOGIN_REQUIRED_FIELDS',
  EMAIL_REQUIRED: 'EMAIL_REQUIRED',
  INVALID_EMAIL_FORMAT: 'INVALID_EMAIL_FORMAT',
  PASSWORD_TOO_SHORT: 'PASSWORD_TOO_SHORT',
  PASSWORD_MISMATCH: 'PASSWORD_MISMATCH',
  INVALID_OTP_CODE: 'INVALID_OTP_CODE',
  OTP_TOKEN_MISSING: 'OTP_TOKEN_MISSING',
  MFA_CODE_REQUIRED: 'MFA_CODE_REQUIRED',
  MFA_SETUP_CODE_INVALID: 'MFA_SETUP_CODE_INVALID',
  EMPTY_MESSAGE: 'EMPTY_MESSAGE',
  MESSAGE_TOO_LONG: 'MESSAGE_TOO_LONG',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',

  // Fallback
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
});

/**
 * Default user-facing messages in Indonesian mapped strictly by error code.
 * Never exposes technical stack traces, SQL, tokens, passwords, keys, or raw server details.
 * @type {Readonly<Record<string, string>>}
 */
export const DEFAULT_USER_MESSAGES = Object.freeze({
  // Network & transport
  [PAGE_ERROR_CODES.NETWORK_ERROR]:
    'Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi.',
  [PAGE_ERROR_CODES.REQUEST_TIMEOUT]:
    'Permintaan membutuhkan waktu terlalu lama. Silakan coba lagi.',
  [PAGE_ERROR_CODES.INVALID_RESPONSE]:
    'Respons dari server tidak dapat diproses. Silakan coba lagi.',

  // Authentication & session
  [PAGE_ERROR_CODES.UNAUTHORIZED]:
    'Sesi Anda telah berakhir. Silakan masuk kembali.',
  [PAGE_ERROR_CODES.SESSION_EXPIRED]:
    'Sesi Anda telah berakhir. Silakan masuk kembali.',
  [PAGE_ERROR_CODES.INVALID_CREDENTIALS]:
    'Email atau kata sandi salah. Silakan periksa kembali dan coba lagi.',
  [PAGE_ERROR_CODES.LOGIN_LOCKED]:
    'Akun dikunci sementara karena terlalu banyak percobaan masuk. Silakan coba lagi nanti.',
  [PAGE_ERROR_CODES.MFA_ALREADY_ENABLED]:
    'Autentikasi dua faktor (MFA) sudah aktif pada akun ini.',
  [PAGE_ERROR_CODES.MFA_NOT_ENABLED]:
    'Autentikasi dua faktor (MFA) belum diaktifkan pada akun ini.',
  [PAGE_ERROR_CODES.INVALID_MFA_CODE]:
    'Kode autentikator atau kode pemulihan tidak valid. Silakan coba lagi.',
  [PAGE_ERROR_CODES.INVALID_RESET_TOKEN]:
    'Kode OTP pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.',
  [PAGE_ERROR_CODES.RESET_TOKEN_EXPIRED]:
    'Kode OTP pengaturan ulang kata sandi telah kedaluwarsa. Silakan minta kode baru.',

  // Authorization
  [PAGE_ERROR_CODES.FORBIDDEN]:
    'Anda tidak memiliki izin untuk melakukan tindakan ini.',
  [PAGE_ERROR_CODES.NOT_CONVERSATION_MEMBER]:
    'Anda bukan anggota dari percakapan ini.',
  [PAGE_ERROR_CODES.NOT_MESSAGE_OWNER]:
    'Anda hanya dapat mengubah atau menghapus pesan milik Anda sendiri.',

  // Validation & payload
  [PAGE_ERROR_CODES.VALIDATION_ERROR]:
    'Data yang dimasukkan belum sesuai. Periksa kembali data Anda.',
  [PAGE_ERROR_CODES.BAD_REQUEST]:
    'Data yang dimasukkan belum sesuai. Periksa kembali data Anda.',
  [PAGE_ERROR_CODES.UNPROCESSABLE_ENTITY]:
    'Data yang dimasukkan belum dapat diproses. Periksa kembali data Anda.',
  [PAGE_ERROR_CODES.PAYLOAD_TOO_LARGE]:
    'Ukuran data atau berkas melebihi batas maksimum yang diizinkan.',

  // Resource / Not found
  [PAGE_ERROR_CODES.NOT_FOUND]:
    'Data atau halaman yang diminta tidak ditemukan.',
  [PAGE_ERROR_CODES.RESOURCE_NOT_FOUND]:
    'Data yang diminta tidak ditemukan.',
  [PAGE_ERROR_CODES.ROUTE_NOT_FOUND]:
    'Layanan yang diminta tidak ditemukan.',
  [PAGE_ERROR_CODES.USER_NOT_FOUND]:
    'Pengguna tidak ditemukan. Periksa kembali username yang dimasukkan.',
  [PAGE_ERROR_CODES.CONVERSATION_NOT_FOUND]:
    'Percakapan tidak ditemukan atau telah dihapus.',
  [PAGE_ERROR_CODES.MESSAGE_NOT_FOUND]:
    'Pesan tidak ditemukan atau telah dihapus.',

  // Conflict
  [PAGE_ERROR_CODES.CONFLICT]:
    'Data yang dikirim sudah ada atau bertentangan dengan data saat ini.',
  [PAGE_ERROR_CODES.USER_ALREADY_EXISTS]:
    'Username atau email sudah terdaftar. Silakan gunakan akun lain atau masuk.',
  [PAGE_ERROR_CODES.FRIENDSHIP_ALREADY_EXISTS]:
    'Pengguna ini sudah ada dalam daftar teman atau permintaan pertemanan Anda.',

  // Rate limit & server
  [PAGE_ERROR_CODES.TOO_MANY_REQUESTS]:
    'Terlalu banyak permintaan dalam waktu singkat. Silakan tunggu beberapa saat lalu coba lagi.',
  [PAGE_ERROR_CODES.SERVER_ERROR]:
    'Terjadi masalah pada server. Silakan coba lagi nanti.',
  [PAGE_ERROR_CODES.INTERNAL_ERROR]:
    'Terjadi masalah pada server. Silakan coba lagi nanti.',

  // Encryption & key management
  [PAGE_ERROR_CODES.ENCRYPTION_FAILED]:
    'Pesan tidak dapat diamankan. Silakan coba lagi.',
  [PAGE_ERROR_CODES.DECRYPTION_FAILED]:
    'Pesan ini tidak dapat dibuka dengan aman.',
  [PAGE_ERROR_CODES.KEY_EXCHANGE_FAILED]:
    'Koneksi aman belum dapat dibuat. Silakan coba lagi.',
  [PAGE_ERROR_CODES.KEY_DERIVATION_FAILED]:
    'Koneksi aman belum dapat dibuat. Silakan coba lagi.',
  [PAGE_ERROR_CODES.KEY_UNAVAILABLE]:
    'Kunci keamanan yang diperlukan tidak tersedia.',
  [PAGE_ERROR_CODES.KEY_STORAGE_FAILED]:
    'Kunci keamanan lokal tidak dapat diakses. Periksa pengaturan penyimpanan browser Anda.',
  [PAGE_ERROR_CODES.INVALID_CIPHERTEXT]:
    'Pesan tidak dapat diverifikasi atau dibuka dengan aman.',
  [PAGE_ERROR_CODES.IDENTITY_KEY_CHANGED]:
    'Kunci keamanan lawan bicara berubah. Verifikasi fingerprint sebelum melanjutkan.',
  [PAGE_ERROR_CODES.IDENTITY_KEY_NOT_FOUND]:
    'Kunci keamanan lawan bicara belum tersedia. Lawan bicara perlu masuk terlebih dahulu.',
  [PAGE_ERROR_CODES.INVALID_PUBLIC_KEY]:
    'Kunci keamanan tidak valid. Silakan muat ulang sesi Anda.',
  [PAGE_ERROR_CODES.KEY_REGISTRY_UNAVAILABLE]:
    'Layanan kunci keamanan sedang tidak tersedia. Silakan coba lagi nanti.',
  [PAGE_ERROR_CODES.FILE_ENCRYPTION_FAILED]:
    'Berkas tidak dapat diamankan untuk dikirim. Silakan coba lagi.',
  [PAGE_ERROR_CODES.FILE_DECRYPTION_FAILED]:
    'Berkas lampiran tidak dapat dibuka atau didekripsi dengan aman.',

  // Store & page operations
  [PAGE_ERROR_CODES.MESSAGE_SEND_FAILED]:
    'Pesan belum dapat dikirim. Silakan coba lagi.',
  [PAGE_ERROR_CODES.MESSAGE_EDIT_FAILED]:
    'Pesan belum dapat diperbarui. Silakan coba lagi.',
  [PAGE_ERROR_CODES.MESSAGE_DELETE_FAILED]:
    'Pesan belum dapat dihapus. Silakan coba lagi.',
  [PAGE_ERROR_CODES.MESSAGE_LOAD_FAILED]:
    'Riwayat pesan belum dapat dimuat. Silakan coba lagi.',
  [PAGE_ERROR_CODES.CONVERSATION_LOAD_FAILED]:
    'Daftar percakapan belum dapat dimuat. Silakan coba lagi.',
  [PAGE_ERROR_CODES.CONVERSATION_CREATE_FAILED]:
    'Percakapan belum dapat dibuka. Silakan coba lagi.',
  [PAGE_ERROR_CODES.FRIENDS_LOAD_FAILED]:
    'Daftar teman belum dapat dimuat. Silakan coba lagi.',
  [PAGE_ERROR_CODES.FRIEND_REQUEST_FAILED]:
    'Permintaan pertemanan belum dapat dikirim. Silakan coba lagi.',
  [PAGE_ERROR_CODES.FRIEND_ACCEPT_FAILED]:
    'Permintaan pertemanan belum dapat diterima. Silakan coba lagi.',
  [PAGE_ERROR_CODES.FRIEND_REJECT_FAILED]:
    'Permintaan pertemanan belum dapat ditolak. Silakan coba lagi.',
  [PAGE_ERROR_CODES.FRIEND_REMOVE_FAILED]:
    'Teman belum dapat dihapus dari daftar. Silakan coba lagi.',
  [PAGE_ERROR_CODES.MFA_STATUS_LOAD_FAILED]:
    'Status keamanan MFA belum dapat dimuat. Silakan coba lagi.',
  [PAGE_ERROR_CODES.MFA_SETUP_FAILED]:
    'Pengaturan MFA belum dapat dimulai. Periksa kembali kata sandi Anda.',
  [PAGE_ERROR_CODES.MFA_DISABLE_FAILED]:
    'MFA belum dapat dinonaktifkan. Periksa kembali kata sandi dan kode autentikator Anda.',
  [PAGE_ERROR_CODES.OTP_SEND_FAILED]:
    'Kode OTP belum dapat dikirimkan. Silakan coba lagi nanti.',
  [PAGE_ERROR_CODES.OTP_VERIFY_FAILED]:
    'Kode OTP belum dapat diverifikasi. Periksa kembali kode Anda.',
  [PAGE_ERROR_CODES.E2EE_PEER_UNAVAILABLE]:
    'Percakapan ini belum mendukung E2EE karena lawan bicara tidak ditemukan.',
  [PAGE_ERROR_CODES.E2EE_NOT_READY]:
    'Sesi keamanan E2EE belum siap atau operasi lain sedang berjalan.',
  [PAGE_ERROR_CODES.OPERATION_BUSY]:
    'Operasi lain sedang berjalan. Silakan tunggu sebentar.',

  // Client-side validation
  [PAGE_ERROR_CODES.REQUIRED_FIELDS]:
    'Semua kolom wajib diisi.',
  [PAGE_ERROR_CODES.LOGIN_REQUIRED_FIELDS]:
    'Silakan masukkan email dan kata sandi.',
  [PAGE_ERROR_CODES.EMAIL_REQUIRED]:
    'Silakan masukkan alamat email Anda.',
  [PAGE_ERROR_CODES.INVALID_EMAIL_FORMAT]:
    'Format email tidak valid. Masukkan alamat email yang benar.',
  [PAGE_ERROR_CODES.PASSWORD_TOO_SHORT]:
    'Kata sandi minimal terdiri dari 8 karakter.',
  [PAGE_ERROR_CODES.PASSWORD_MISMATCH]:
    'Konfirmasi kata sandi tidak cocok.',
  [PAGE_ERROR_CODES.INVALID_OTP_CODE]:
    'Silakan masukkan 6 digit angka kode OTP lengkap.',
  [PAGE_ERROR_CODES.OTP_TOKEN_MISSING]:
    'Kode OTP 6-digit atau informasi email tidak ditemukan. Silakan lakukan verifikasi ulang melalui halaman lupa kata sandi.',
  [PAGE_ERROR_CODES.MFA_CODE_REQUIRED]:
    'Masukkan kode autentikator atau kode pemulihan.',
  [PAGE_ERROR_CODES.MFA_SETUP_CODE_INVALID]:
    'Masukkan tepat 6 digit dari aplikasi autentikator.',
  [PAGE_ERROR_CODES.EMPTY_MESSAGE]:
    'Isi pesan tidak boleh kosong.',
  [PAGE_ERROR_CODES.MESSAGE_TOO_LONG]:
    'Pesan melebihi batas panjang maksimum (10 KB).',
  [PAGE_ERROR_CODES.FILE_TOO_LARGE]:
    'Ukuran berkas melebihi batas maksimum 25 MB.',

  // Fallback
  [PAGE_ERROR_CODES.UNKNOWN_ERROR]:
    'Terjadi kesalahan yang tidak terduga. Silakan coba lagi.'
});

/**
 * Context-specific user message overrides for finer UX without exposing backend details.
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const CONTEXT_USER_MESSAGES = Object.freeze({
  login: Object.freeze({
    [PAGE_ERROR_CODES.UNAUTHORIZED]:
      'Email atau kata sandi salah. Silakan coba lagi.',
    [PAGE_ERROR_CODES.BAD_REQUEST]:
      'Data login belum sesuai. Periksa kembali email dan kata sandi Anda.',
    [PAGE_ERROR_CODES.VALIDATION_ERROR]:
      'Data login belum sesuai. Periksa kembali email dan kata sandi Anda.'
  }),
  register: Object.freeze({
    [PAGE_ERROR_CODES.CONFLICT]:
      'Username atau email sudah terdaftar. Silakan gunakan yang lain.',
    [PAGE_ERROR_CODES.BAD_REQUEST]:
      'Data pendaftaran belum sesuai. Periksa kembali formulir Anda.',
    [PAGE_ERROR_CODES.VALIDATION_ERROR]:
      'Data pendaftaran belum sesuai. Periksa kembali formulir Anda.'
  }),
  mfa: Object.freeze({
    [PAGE_ERROR_CODES.UNAUTHORIZED]:
      'Kode autentikator atau kode pemulihan tidak valid. Silakan coba lagi.',
    [PAGE_ERROR_CODES.BAD_REQUEST]:
      'Kode autentikator tidak valid. Periksa kembali kode Anda.',
    [PAGE_ERROR_CODES.VALIDATION_ERROR]:
      'Kode autentikator tidak valid. Periksa kembali kode Anda.'
  }),
  'forgot-password': Object.freeze({
    [PAGE_ERROR_CODES.BAD_REQUEST]:
      'Alamat email tidak valid. Periksa kembali email yang dimasukkan.',
    [PAGE_ERROR_CODES.VALIDATION_ERROR]:
      'Alamat email tidak valid. Periksa kembali email yang dimasukkan.'
  }),
  'reset-password': Object.freeze({
    [PAGE_ERROR_CODES.BAD_REQUEST]:
      'Kode OTP pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.',
    [PAGE_ERROR_CODES.VALIDATION_ERROR]:
      'Kode OTP pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.',
    [PAGE_ERROR_CODES.UNAUTHORIZED]:
      'Kode OTP pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.'
  }),
  'verify-otp': Object.freeze({
    [PAGE_ERROR_CODES.BAD_REQUEST]:
      'Kode OTP tidak valid. Periksa kembali 6 digit kode Anda.',
    [PAGE_ERROR_CODES.VALIDATION_ERROR]:
      'Kode OTP tidak valid. Periksa kembali 6 digit kode Anda.'
  }),
  'security-settings': Object.freeze({
    [PAGE_ERROR_CODES.UNAUTHORIZED]:
      'Kata sandi atau kode autentikator tidak sesuai. Silakan periksa kembali.',
    [PAGE_ERROR_CODES.BAD_REQUEST]:
      'Data keamanan belum sesuai. Periksa kembali kata sandi dan kode autentikator Anda.',
    [PAGE_ERROR_CODES.VALIDATION_ERROR]:
      'Data keamanan belum sesuai. Periksa kembali kata sandi dan kode autentikator Anda.'
  }),
  friends: Object.freeze({
    [PAGE_ERROR_CODES.NOT_FOUND]:
      'Pengguna atau permintaan pertemanan tidak ditemukan.',
    [PAGE_ERROR_CODES.RESOURCE_NOT_FOUND]:
      'Pengguna atau permintaan pertemanan tidak ditemukan.',
    [PAGE_ERROR_CODES.CONFLICT]:
      'Permintaan pertemanan sudah dikirim atau pengguna sudah menjadi teman Anda.',
    [PAGE_ERROR_CODES.BAD_REQUEST]:
      'Permintaan pertemanan tidak dapat diproses. Periksa kembali username yang dimasukkan.',
    [PAGE_ERROR_CODES.VALIDATION_ERROR]:
      'Permintaan pertemanan tidak dapat diproses. Periksa kembali username yang dimasukkan.'
  }),
  chat: Object.freeze({
    [PAGE_ERROR_CODES.NOT_FOUND]:
      'Percakapan atau pesan tidak ditemukan.',
    [PAGE_ERROR_CODES.RESOURCE_NOT_FOUND]:
      'Percakapan atau pesan tidak ditemukan.',
    [PAGE_ERROR_CODES.FORBIDDEN]:
      'Anda tidak memiliki akses ke percakapan ini.'
  }),
  'send-message': Object.freeze({
    [PAGE_ERROR_CODES.BAD_REQUEST]:
      'Pesan tidak dapat dikirim karena format tidak sesuai.',
    [PAGE_ERROR_CODES.VALIDATION_ERROR]:
      'Pesan tidak dapat dikirim karena format tidak sesuai.',
    [PAGE_ERROR_CODES.PAYLOAD_TOO_LARGE]:
      'Pesan melebihi batas ukuran maksimum (10 KB).'
  }),
  'edit-message': Object.freeze({
    [PAGE_ERROR_CODES.FORBIDDEN]:
      'Anda hanya dapat mengedit pesan milik Anda sendiri.',
    [PAGE_ERROR_CODES.NOT_FOUND]:
      'Pesan yang ingin diedit tidak ditemukan atau telah dihapus.'
  }),
  'delete-message': Object.freeze({
    [PAGE_ERROR_CODES.FORBIDDEN]:
      'Anda hanya dapat menghapus pesan milik Anda sendiri.',
    [PAGE_ERROR_CODES.NOT_FOUND]:
      'Pesan yang ingin dihapus tidak ditemukan.'
  }),
  attachment: Object.freeze({
    [PAGE_ERROR_CODES.ENCRYPTION_FAILED]:
      'Berkas tidak dapat diamankan untuk dikirim. Silakan coba lagi.',
    [PAGE_ERROR_CODES.DECRYPTION_FAILED]:
      'Berkas lampiran tidak dapat dibuka atau didekripsi dengan aman.',
    [PAGE_ERROR_CODES.INVALID_CIPHERTEXT]:
      'Berkas lampiran tidak dapat diverifikasi atau dibuka dengan aman.',
    [PAGE_ERROR_CODES.PAYLOAD_TOO_LARGE]:
      'Ukuran berkas melebihi batas maksimum 25 MB.',
    [PAGE_ERROR_CODES.NOT_FOUND]:
      'Berkas lampiran tidak ditemukan di server.',
    [PAGE_ERROR_CODES.RESOURCE_NOT_FOUND]:
      'Berkas lampiran tidak ditemukan di server.'
  }),
  e2ee: Object.freeze({
    [PAGE_ERROR_CODES.NOT_FOUND]:
      'Kunci keamanan lawan bicara belum tersedia. Lawan bicara perlu masuk terlebih dahulu.',
    [PAGE_ERROR_CODES.RESOURCE_NOT_FOUND]:
      'Kunci keamanan lawan bicara belum tersedia. Lawan bicara perlu masuk terlebih dahulu.'
  })
});

/** @type {Set<string>} */
const KNOWN_PAGE_CODES = new Set(Object.keys(DEFAULT_USER_MESSAGES));
/** @type {Set<string>} */
const SAFE_SOURCES = new Set(['api', 'encryption', 'validation', 'store', 'page', 'socket', 'unknown']);

/**
 * Check if a candidate code is a registered error code in `pageerror`.
 * @param {any} code
 * @returns {boolean}
 */
export function isKnownErrorCode(code) {
  return typeof code === 'string' && KNOWN_PAGE_CODES.has(code);
}

/**
 * Extract a registered error code strictly from `code` / `errorCode` properties or string code.
 * Never inspects `error.message` or matches exception text.
 *
 * @param {any} errorOrCode
 * @param {string} [fallbackCode]
 * @returns {{ code: string, source: string }}
 */
function extractCodeAndSource(errorOrCode, fallbackCode) {
  const validFallback =
    typeof fallbackCode === 'string' && isKnownErrorCode(fallbackCode)
      ? fallbackCode
      : PAGE_ERROR_CODES.UNKNOWN_ERROR;

  if (typeof errorOrCode === 'string') {
    const normalized = errorOrCode.trim().toUpperCase();
    if (isKnownErrorCode(normalized)) {
      return { code: normalized, source: 'page' };
    }
    return { code: PAGE_ERROR_CODES.UNKNOWN_ERROR, source: 'unknown' };
  }

  if (errorOrCode && typeof errorOrCode === 'object') {
    const rawSource = typeof errorOrCode.source === 'string' ? errorOrCode.source.toLowerCase() : '';
    const safeSource = SAFE_SOURCES.has(rawSource) ? rawSource : 'unknown';

    if (errorOrCode.name === 'IdentityKeyChangedError') {
      return { code: PAGE_ERROR_CODES.IDENTITY_KEY_CHANGED, source: 'encryption' };
    }

    const candidateCode =
      typeof errorOrCode.code === 'string'
        ? errorOrCode.code.trim().toUpperCase()
        : typeof errorOrCode.errorCode === 'string'
          ? errorOrCode.errorCode.trim().toUpperCase()
          : '';

    if (candidateCode && isKnownErrorCode(candidateCode)) {
      return { code: candidateCode, source: safeSource };
    }

    const candidateCategory =
      typeof errorOrCode.category === 'string'
        ? errorOrCode.category.trim().toUpperCase()
        : '';

    if (candidateCategory && isKnownErrorCode(candidateCategory)) {
      return { code: candidateCategory, source: safeSource };
    }

    return { code: validFallback, source: safeSource };
  }

  return { code: validFallback, source: 'unknown' };
}

/**
 * Resolve an error code or normalized error object into a user-safe presentation object.
 * Strictly maps by error `code` (and optional `context`), never by matching `error.message`.
 *
 * @param {any} errorOrCode
 * @param {string | { context?: string, fallbackCode?: string }} [options]
 * @returns {{ code: string, source: string, userMessage: string }}
 */
export function resolvePageError(errorOrCode, options = {}) {
  const opts =
    typeof options === 'string'
      ? { context: options }
      : options && typeof options === 'object'
        ? options
        : {};

  const { code, source } = extractCodeAndSource(errorOrCode, opts.fallbackCode);
  const contextKey = typeof opts.context === 'string' ? opts.context.trim().toLowerCase() : '';

  const contextMap = contextKey ? CONTEXT_USER_MESSAGES[contextKey] : undefined;
  const userMessage =
    (contextMap && contextMap[code]) ||
    DEFAULT_USER_MESSAGES[code] ||
    DEFAULT_USER_MESSAGES[PAGE_ERROR_CODES.UNKNOWN_ERROR];

  const finalCode = isKnownErrorCode(code) ? code : PAGE_ERROR_CODES.UNKNOWN_ERROR;

  return {
    code: finalCode,
    source,
    userMessage
  };
}

/**
 * Convenience helper returning only the user-friendly Indonesian message string for UI display.
 *
 * @param {any} errorOrCode
 * @param {string | { context?: string, fallbackCode?: string }} [options]
 * @returns {string}
 */
export function getPageErrorMessage(errorOrCode, options = {}) {
  return resolvePageError(errorOrCode, options).userMessage;
}

/**
 * Create a structured client-side validation error object using a standard code.
 *
 * @param {string} [code=PAGE_ERROR_CODES.VALIDATION_ERROR]
 * @param {string} [context]
 * @returns {{ code: string, source: 'validation', userMessage: string }}
 */
export function createValidationError(code = PAGE_ERROR_CODES.VALIDATION_ERROR, context) {
  const resolved = resolvePageError(code, {
    context,
    fallbackCode: PAGE_ERROR_CODES.VALIDATION_ERROR
  });
  return {
    code: resolved.code,
    source: 'validation',
    userMessage: resolved.userMessage
  };
}

export default {
  PAGE_ERROR_CODES,
  DEFAULT_USER_MESSAGES,
  CONTEXT_USER_MESSAGES,
  isKnownErrorCode,
  resolvePageError,
  getPageErrorMessage,
  createValidationError
};

