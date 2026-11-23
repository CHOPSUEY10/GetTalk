import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from this module so loading does not depend on the process cwd.
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const SMTP_ENV_KEYS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
];

/**
 * Load variables from an env file into `process.env`.
 * Unlike default `dotenv.config()`, this also populates keys that currently
 * exist in `process.env` as an empty/whitespace-only string `""` (e.g. cached
 * by PM2 from an initial `.env.example` template before credentials were set).
 *
 * @param {string} filePath
 * @param {{ onlyKeys?: string[] }} [options]
 */
function loadEnvFile(filePath, { onlyKeys = null } = {}) {
  if (!existsSync(filePath)) return;
  try {
    const parsed = dotenv.parse(readFileSync(filePath, 'utf8'));
    for (const [key, rawValue] of Object.entries(parsed)) {
      if (onlyKeys && !onlyKeys.includes(key)) continue;
      const value = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (!value) continue;
      const existing = process.env[key];
      if (existing === undefined || existing.trim() === '') {
        process.env[key] = value;
      }
    }
  } catch {
    // Fallback to standard dotenv if read/parse encounters an issue
    if (!onlyKeys) {
      dotenv.config({ path: filePath });
    }
  }
}

function stripOuterQuotes(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/^["']+|["']+$/g, '').trim();
}

function normalizeSmtpFrom(rawSmtpFrom, smtpUser, smtpHost) {
  const cleanedFrom = stripOuterQuotes(rawSmtpFrom);
  const cleanedUser = stripOuterQuotes(smtpUser);
  const cleanedHost = stripOuterQuotes(smtpHost).toLowerCase();
  const isUserEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedUser);

  if (!cleanedFrom) {
    return isUserEmail
      ? `GetTalk Security <${cleanedUser}>`
      : 'GetTalk Security <no-reply@gettalk.local>';
  }

  if (isUserEmail) {
    const hasPlaceholderDomain = /@(gettalk\.app|gettalk\.local)\b/i.test(cleanedFrom);
    const isGmailHost = cleanedHost.includes('gmail.com');
    const containsSmtpUser = cleanedFrom.toLowerCase().includes(cleanedUser.toLowerCase());

    if (hasPlaceholderDomain || (isGmailHost && !containsSmtpUser)) {
      const nameMatch = cleanedFrom.match(/^([^<]+)</);
      const displayName = stripOuterQuotes(nameMatch ? nameMatch[1] : '') || 'GetTalk Security';
      return `${displayName} <${cleanedUser}>`;
    }
  }

  return cleanedFrom;
}

const explicitNodeEnv = process.env.NODE_ENV?.trim();
const defaultEnvPath = resolve(backendRoot, '.env');
const defaultLocalEnvPath = resolve(backendRoot, '.env.local');

// If NODE_ENV was not explicitly set in the shell (e.g. `pm2 start server.js`),
// check `.env.local` / `.env` first, and prefer `.env.production` if
// `.env.development` does not exist.
if (!explicitNodeEnv) {
  loadEnvFile(defaultLocalEnvPath);
  loadEnvFile(defaultEnvPath);
}

const resolvedMode =
  process.env.NODE_ENV?.trim() ||
  (!existsSync(resolve(backendRoot, '.env.development')) &&
  existsSync(resolve(backendRoot, '.env.production'))
    ? 'production'
    : 'development');

const modeEnvPath = resolve(backendRoot, `.env.${resolvedMode}`);
const localEnvPath = resolve(backendRoot, `.env.${resolvedMode}.local`);

// .local overrides (developer-specific, never committed) take precedence.
loadEnvFile(localEnvPath);
loadEnvFile(modeEnvPath);
loadEnvFile(defaultLocalEnvPath);
loadEnvFile(defaultEnvPath);

// Ensure SMTP credentials are not missed if configured in `.env.production` or
// `.env.development` while the other file still has blank template placeholders.
if (!process.env.SMTP_USER?.trim() || !process.env.SMTP_PASS?.trim()) {
  for (const candidate of [
    resolve(backendRoot, '.env.production.local'),
    resolve(backendRoot, '.env.production'),
    resolve(backendRoot, '.env.development.local'),
    resolve(backendRoot, '.env.development'),
    defaultLocalEnvPath,
    defaultEnvPath,
  ]) {
    loadEnvFile(candidate, { onlyKeys: SMTP_ENV_KEYS });
  }
}

const allowedEnvironments = [
  'development',
  'staging',
  'production'
];

function requiredEnv(name) {
  const value = process.env[name];

  if (!value || value.trim() === '') {
    throw new Error(
      `Environment variable ${name} belum dikonfigurasi`
    );
  }

  return value.trim();
}

function positiveIntegerEnv(name, defaultValue) {
  const value = process.env[name];

  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${name} harus berupa bilangan bulat positif`
    );
  }

  return parsed;
}

/**
 * Encrypted-attachment object storage (pre-signed URLs).
 *
 * STORAGE_DRIVER=local  files on disk; pre-signed URLs are HMAC-signed,
 *                       short-lived backend URLs (/api/storage/:token).
 * STORAGE_DRIVER=s3     any S3-compatible store (MinIO, Supabase Storage,
 *                       Cloudflare R2, AWS S3); browsers transfer bytes
 *                       directly to the store with SigV4 pre-signed URLs.
 */
function storageConfig(sessionSecret) {
  const driver = (process.env.STORAGE_DRIVER?.trim() || 'local').toLowerCase();
  if (!['local', 's3'].includes(driver)) {
    throw new Error(`STORAGE_DRIVER tidak valid: ${driver} (gunakan local atau s3)`);
  }

  const urlTtlSeconds = positiveIntegerEnv('ATTACHMENT_URL_TTL_SECONDS', 300);
  if (urlTtlSeconds > 3600) {
    throw new Error('ATTACHMENT_URL_TTL_SECONDS maksimal 3600 detik');
  }

  // Dedicated signing secret for local pre-signed URLs; falls back to the
  // session secret (a domain-separated key is derived from it, see storage).
  const urlSigningSecret = process.env.ATTACHMENT_URL_SECRET?.trim() || sessionSecret;

  const config = { driver, urlTtlSeconds, urlSigningSecret, s3: null };

  if (driver === 's3') {
    const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
    config.s3 = {
      endpoint,
      // Host reachable by browsers when it differs from the internal endpoint
      // (e.g. backend talks to http://minio:9000, browser uses https://files.example.com).
      publicEndpoint: process.env.S3_PUBLIC_ENDPOINT?.trim() || endpoint,
      region: process.env.S3_REGION?.trim() || 'us-east-1',
      bucket: requiredEnv('S3_BUCKET'),
      accessKeyId: requiredEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('S3_SECRET_ACCESS_KEY'),
      // MinIO/Supabase need path-style addressing; AWS S3 does not.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE
        ? process.env.S3_FORCE_PATH_STYLE === 'true'
        : Boolean(endpoint),
    };
  }

  return config;
}

function validateEnvironment() {
  const nodeEnv = requiredEnv('NODE_ENV');

  if (!allowedEnvironments.includes(nodeEnv)) {
    throw new Error(
      `NODE_ENV tidak valid: ${nodeEnv}`
    );
  }

  const host = requiredEnv('HOST');
  const port = positiveIntegerEnv('PORT', 3000);
  const corsOrigin = requiredEnv('CORS_ORIGIN');
  const corsOrigins = corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const databaseUrl = requiredEnv('DATABASE_URL');
  const sessionSecret = requiredEnv('SESSION_SECRET');
  const mfaEncryptionKey = process.env.MFA_ENCRYPTION_KEY?.trim() || sessionSecret;
  // Optional so the app still boots when Redis is down; the key registry
  // then fails safely with 503 (issue #11).
  const redisUrl = process.env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379';
  // Shared Upstash Redis REST credentials & Kill Switch state key (controlled by SIEM SecAdmin)
  const upstashRedisRestUrl = stripOuterQuotes(
    process.env.UPSTASH_REDIS_REST_URL || process.env.TELEMETRY_UPSTASH_REDIS_REST_URL
  );
  const upstashRedisRestToken = stripOuterQuotes(
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.TELEMETRY_UPSTASH_REDIS_REST_TOKEN
  );
  const killSwitchRedisKey =
    stripOuterQuotes(process.env.KILL_SWITCH_REDIS_KEY || process.env.TELEMETRY_KILL_SWITCH_KEY) ||
    'siem:backend:enabled';
  const rawKillSwitchCacheMs = process.env.KILL_SWITCH_CACHE_TTL_MS?.trim();
  const killSwitchCacheTtlMs =
    rawKillSwitchCacheMs !== undefined && rawKillSwitchCacheMs !== ''
      ? Math.max(0, Number(rawKillSwitchCacheMs) || 0)
      : 1000;
  // Local encrypted-attachment storage. Replace with object storage in
  // production if needed; the key is opaque and server-generated.
  const storageDir = resolve(backendRoot, process.env.STORAGE_DIR?.trim() || 'storage');
  const storage = storageConfig(sessionSecret);

  // SMTP configuration for transactional emails (OTP / Password Reset)
  const smtpHost = stripOuterQuotes(process.env.SMTP_HOST);
  const smtpPort = positiveIntegerEnv('SMTP_PORT', 587);
  const smtpSecure =
    stripOuterQuotes(process.env.SMTP_SECURE).toLowerCase() === 'true' || smtpPort === 465;
  const smtpUser = stripOuterQuotes(process.env.SMTP_USER);
  // Strip spaces & surrounding quotes in case a 16-char Google App Password is pasted with spaces
  const smtpPass = process.env.SMTP_PASS
    ? stripOuterQuotes(process.env.SMTP_PASS).replace(/\s+/g, '')
    : '';
  const smtpFrom = normalizeSmtpFrom(process.env.SMTP_FROM, smtpUser, smtpHost);

  // Reverse-proxy (Nginx) trust (1 hop by default in production)
  const rawTrustProxy = process.env.TRUST_PROXY?.trim();
  const trustProxy =
    rawTrustProxy !== undefined && rawTrustProxy !== ''
      ? rawTrustProxy === 'true'
        ? 1
        : rawTrustProxy === 'false'
          ? false
          : Number.isInteger(Number(rawTrustProxy))
            ? Number(rawTrustProxy)
            : 1
      : nodeEnv === 'production'
        ? 1
        : false;

  // Session cookie configuration (supports 2-subdomain deployment behind Nginx HTTPS)
  const cookieSecure =
    process.env.COOKIE_SECURE !== undefined && process.env.COOKIE_SECURE.trim() !== ''
      ? process.env.COOKIE_SECURE.trim() === 'true'
      : nodeEnv === 'production';

  const rawSameSite = process.env.COOKIE_SAME_SITE?.trim().toLowerCase();
  if (rawSameSite && !['lax', 'strict', 'none'].includes(rawSameSite)) {
    throw new Error(
      `COOKIE_SAME_SITE tidak valid: ${rawSameSite} (gunakan lax, strict, atau none)`
    );
  }
  // For two separate subdomains in production over HTTPS (especially public suffixes
  // like sslip.io), 'none' + Secure ensures fetch(credentials: 'include') and
  // Socket.IO (withCredentials: true) always work.
  const cookieSameSite = rawSameSite || (cookieSecure && nodeEnv === 'production' ? 'none' : 'lax');
  const cookieDomain = process.env.COOKIE_DOMAIN?.trim() || undefined;

  const cookie = {
    secure: cookieSecure,
    sameSite: cookieSameSite === 'none' && !cookieSecure ? 'lax' : cookieSameSite,
    domain: cookieDomain,
  };

  return {
    nodeEnv,
    host,
    port,
    corsOrigin,
    corsOrigins,
    databaseUrl,
    sessionSecret,
    mfaEncryptionKey,
    redisUrl,
    upstashRedisRestUrl,
    upstashRedisRestToken,
    killSwitchRedisKey,
    killSwitchCacheTtlMs,
    storageDir,
    storage,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPass,
    smtpFrom,
    trustProxy,
    cookie,
  };
}

const env = validateEnvironment();

export default env;
