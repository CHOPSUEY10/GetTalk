import cors from 'cors';
import env from './env.js';
import AppError from '../errors/AppError.js';
import { FORBIDDEN } from '../errors/error-codes.js';

/**
 * Metode HTTP yang diizinkan dalam request lintas-origin (CORS).
 */
export const ALLOWED_CORS_METHODS = [
  'GET',
  'HEAD',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
  'OPTIONS',
];

/**
 * Header yang diizinkan dalam request & preflight (OPTIONS),
 * termasuk header kustom E2EE untuk unggahan lampiran terenkripsi.
 */
export const ALLOWED_CORS_HEADERS = [
  'Content-Type',
  'Accept',
  'X-Message-Id',
  'X-Metadata-Ciphertext',
  'X-Metadata-Nonce',
];

/**
 * Memvalidasi dan menormalisasi satu nilai origin.
 *
 * Aturan validasi:
 *  1. Menolak wildcard (`*`) apabila `credentials: true`.
 *  2. Menolak origin `"null"`.
 *  3. Memastikan protokol adalah `http://` atau `https://`.
 *  4. Menolak origin yang memuat path, query string, hash, atau kredensial URL.
 *
 * @param {string} rawEntry
 * @param {{ credentials?: boolean }} [options]
 * @returns {string} Origin ternormalisasi (`scheme://host[:port]`)
 */
export function validateOriginEntry(rawEntry, { credentials = true } = {}) {
  if (typeof rawEntry !== 'string' || rawEntry.trim() === '') {
    throw new Error('CORS_ORIGIN mengandung nilai origin kosong');
  }

  const entry = rawEntry.trim();

  if (entry === '*' || entry.includes('*')) {
    if (credentials) {
      throw new Error(
        `CORS_ORIGIN tidak boleh menggunakan wildcard (*) saat credentials: true (ditemukan: "${entry}")`
      );
    }
    return '*';
  }

  if (entry.toLowerCase() === 'null') {
    throw new Error('CORS_ORIGIN tidak boleh menggunakan origin "null"');
  }

  if (!/^https?:\/\//i.test(entry)) {
    throw new Error(
      `CORS_ORIGIN "${entry}" tidak valid: origin harus memiliki protokol http:// atau https://`
    );
  }

  let parsed;
  try {
    parsed = new URL(entry);
  } catch {
    throw new Error(`CORS_ORIGIN "${entry}" bukan URL origin yang valid`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `CORS_ORIGIN "${entry}" tidak valid: protokol harus http:// atau https://`
    );
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== '/')
  ) {
    throw new Error(
      `CORS_ORIGIN "${entry}" tidak valid: origin tidak boleh menyertakan path, query, hash, atau kredensial`
    );
  }

  return parsed.origin;
}

/**
 * Mengurai dan memvalidasi daftar `CORS_ORIGIN` (mendukung multi-origin
 * yang dipisahkan koma maupun array string).
 *
 * @param {string | string[]} rawCorsOrigin
 * @param {{ credentials?: boolean }} [options]
 * @returns {string[]} Daftar origin sah yang telah dinormalisasi
 */
export function parseCorsOrigins(rawCorsOrigin, { credentials = true } = {}) {
  const rawItems = Array.isArray(rawCorsOrigin)
    ? rawCorsOrigin.flatMap((item) => (typeof item === 'string' ? item.split(',') : [item]))
    : typeof rawCorsOrigin === 'string'
      ? rawCorsOrigin.split(',')
      : [];

  const entries = rawItems
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  if (entries.length === 0) {
    throw new Error('CORS_ORIGIN harus berisi minimal satu origin yang valid');
  }

  const allowedSet = new Set();
  for (const entry of entries) {
    const normalized = validateOriginEntry(entry, { credentials });
    allowedSet.add(normalized);
  }

  return Array.from(allowedSet);
}

/**
 * Memeriksa apakah `requestOrigin` yang masuk termasuk dalam allowlist.
 *
 * @param {string | undefined} requestOrigin
 * @param {Iterable<string>} allowedOrigins
 * @returns {string | null} Origin yang cocok atau `null` bila ditolak
 */
export function matchAllowedOrigin(requestOrigin, allowedOrigins) {
  if (!requestOrigin || typeof requestOrigin !== 'string') {
    return null;
  }

  const allowedSet =
    allowedOrigins instanceof Set ? allowedOrigins : new Set(allowedOrigins);

  let parsed;
  try {
    parsed = new URL(requestOrigin);
  } catch {
    return null;
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== '/')
  ) {
    return null;
  }

  return allowedSet.has(parsed.origin) ? parsed.origin : null;
}

/**
 * Membangun objek opsi konfigurasi untuk middleware `cors` (Express & Socket.IO).
 *
 * @param {string | string[]} [rawCorsOrigin]
 * @param {{ credentials?: boolean }} [options]
 * @returns {import('cors').CorsOptions}
 */
export function createCorsOptions(
  rawCorsOrigin = env.corsOrigins ?? env.corsOrigin,
  { credentials = true } = {}
) {
  const allowedOrigins = parseCorsOrigins(rawCorsOrigin, { credentials });
  const allowedOriginSet = new Set(allowedOrigins);

  return {
    origin(requestOrigin, callback) {
      // Permintaan tanpa header Origin (same-origin non-CORS, server-to-server,
      // atau pengujian internal) diteruskan tanpa menyertakan header CORS.
      if (!requestOrigin) {
        return callback(null, false);
      }

      if (allowedOriginSet.has('*') && !credentials) {
        return callback(null, '*');
      }

      const matchedOrigin = matchAllowedOrigin(requestOrigin, allowedOriginSet);
      if (matchedOrigin) {
        return callback(null, matchedOrigin);
      }

      return callback(
        AppError.forbidden('Origin tidak diizinkan oleh kebijakan CORS', FORBIDDEN)
      );
    },
    credentials,
    methods: ALLOWED_CORS_METHODS,
    allowedHeaders: ALLOWED_CORS_HEADERS,
    optionsSuccessStatus: 204,
  };
}

/**
 * Membuat Express middleware CORS tervalidasi dari `CORS_ORIGIN`.
 *
 * @param {string | string[]} [rawCorsOrigin]
 * @param {{ credentials?: boolean }} [options]
 */
export function createCorsMiddleware(
  rawCorsOrigin = env.corsOrigins ?? env.corsOrigin,
  options = {}
) {
  const optionsConfig = createCorsOptions(rawCorsOrigin, options);
  const middleware = cors(optionsConfig);

  return function corsMiddleware(req, res, next) {
    res.vary('Origin');
    return middleware(req, res, next);
  };
}

export const allowedCorsOrigins = parseCorsOrigins(env.corsOrigin, {
  credentials: true,
});

export const corsOptions = createCorsOptions(allowedCorsOrigins, {
  credentials: true,
});

const corsMiddleware = createCorsMiddleware(allowedCorsOrigins, {
  credentials: true,
});

export default corsMiddleware;

