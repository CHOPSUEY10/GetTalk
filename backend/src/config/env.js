import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from this module so loading does not depend on the process cwd.
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultEnvPath = resolve(backendRoot, '.env');
const environmentName = process.env.NODE_ENV || 'development';
const modeEnvPath = resolve(backendRoot, `.env.${environmentName}`);
const localEnvPath = resolve(backendRoot, `.env.${environmentName}.local`);
const envPath = existsSync(modeEnvPath) ? modeEnvPath : defaultEnvPath;

// .local overrides (developer-specific, never committed) take precedence,
// same order as prisma.config.js. dotenv never overwrites an existing key.
if (existsSync(localEnvPath)) dotenv.config({ path: localEnvPath });
dotenv.config({ path: envPath });

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
  // Local encrypted-attachment storage. Replace with object storage in
  // production if needed; the key is opaque and server-generated.
  const storageDir = resolve(backendRoot, process.env.STORAGE_DIR?.trim() || 'storage');
  const storage = storageConfig(sessionSecret);

  // SMTP configuration for transactional emails (OTP / Password Reset)
  const smtpHost = process.env.SMTP_HOST?.trim() || '';
  const smtpPort = positiveIntegerEnv('SMTP_PORT', 587);
  const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;
  const smtpUser = process.env.SMTP_USER?.trim() || '';
  // Strip spaces in case a 16-char Google App Password is pasted with spaces
  const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, '') : '';
  const smtpFrom =
    process.env.SMTP_FROM?.trim() ||
    smtpUser ||
    'GetTalk Security <no-reply@gettalk.local>';

  // Reverse-proxy / Cloudflare trust (1 hop by default in production)
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

  // Native Node.js HTTPS / TLS configuration (for VPS deployment without Nginx/Caddy)
  const defaultCertPath = resolve(backendRoot, 'certs/cert.pem');
  const defaultKeyPath = resolve(backendRoot, 'certs/key.pem');
  const sslCertPath = process.env.SSL_CERT_PATH?.trim()
    ? resolve(backendRoot, process.env.SSL_CERT_PATH.trim())
    : defaultCertPath;
  const sslKeyPath = process.env.SSL_KEY_PATH?.trim()
    ? resolve(backendRoot, process.env.SSL_KEY_PATH.trim())
    : defaultKeyPath;
  const sslCaPath = process.env.SSL_CA_PATH?.trim()
    ? resolve(backendRoot, process.env.SSL_CA_PATH.trim())
    : undefined;
  const sslEnabled =
    process.env.SSL_ENABLED === 'true'
      ? true
      : process.env.SSL_ENABLED === 'false'
        ? false
        : existsSync(sslCertPath) && existsSync(sslKeyPath);

  const ssl = {
    enabled: sslEnabled,
    certPath: sslCertPath,
    keyPath: sslKeyPath,
    caPath: sslCaPath && existsSync(sslCaPath) ? sslCaPath : undefined,
  };

  // Session cookie configuration (supports cross-subdomain / 2-subdomain deployment)
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
  // For two separate subdomains in production over HTTPS, 'none' + Secure ensures
  // fetch(credentials: 'include') and Socket.IO (withCredentials: true) always work.
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
    storageDir,
    storage,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPass,
    smtpFrom,
    trustProxy,
    ssl,
    cookie,
  };
}

const env = validateEnvironment();

export default env;
