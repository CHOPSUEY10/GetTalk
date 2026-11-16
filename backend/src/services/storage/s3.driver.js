import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

/**
 * AWS Signature Version 4 (SigV4) helper using built-in `node:crypto`.
 * Avoids heavy external SDK dependencies while maintaining full compatibility
 * with AWS S3, MinIO, Supabase Storage S3, and Cloudflare R2.
 */
function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

function deriveSigningKey(secretAccessKey, dateStamp, region, service = 's3') {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function encodeRfc3986(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function toAmzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function buildObjectUrl(baseEndpoint, bucket, storageKey, forcePathStyle = true) {
  const rawBase = baseEndpoint || 'https://s3.amazonaws.com';
  const baseUrl = new URL(rawBase);
  const encodedKey = storageKey
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');

  if (forcePathStyle) {
    const basePath = baseUrl.pathname.replace(/\/+$/, '');
    baseUrl.pathname = `${basePath}/${encodeRfc3986(bucket)}/${encodedKey}`;
  } else {
    baseUrl.hostname = `${bucket}.${baseUrl.hostname}`;
    const basePath = baseUrl.pathname.replace(/\/+$/, '');
    baseUrl.pathname = `${basePath}/${encodedKey}`;
  }

  return baseUrl;
}

function presignSigV4Url({
  method,
  endpoint,
  region,
  bucket,
  storageKey,
  accessKeyId,
  secretAccessKey,
  forcePathStyle,
  expiresInSeconds,
  signedHeaders = {},
  extraQueryParams = {},
  now = new Date(),
}) {
  const targetUrl = buildObjectUrl(endpoint, bucket, storageKey, forcePathStyle);
  const { amzDate, dateStamp } = toAmzDate(now);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  const normalizedHeaders = {
    host: targetUrl.host,
  };
  for (const [k, v] of Object.entries(signedHeaders)) {
    if (v !== undefined && v !== null) {
      normalizedHeaders[k.toLowerCase()] = String(v).trim();
    }
  }

  const sortedHeaderNames = Object.keys(normalizedHeaders).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${normalizedHeaders[name]}\n`)
    .join('');
  const signedHeadersList = sortedHeaderNames.join(';');

  const queryEntries = {
    ...extraQueryParams,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.max(1, Math.min(604800, expiresInSeconds))),
    'X-Amz-SignedHeaders': signedHeadersList,
  };

  const canonicalQueryString = Object.keys(queryEntries)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(String(queryEntries[k]))}`)
    .join('&');

  const canonicalRequest = [
    method.toUpperCase(),
    targetUrl.pathname,
    canonicalQueryString,
    canonicalHeaders,
    signedHeadersList,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigningKey(secretAccessKey, dateStamp, region, 's3');
  const signature = createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');

  return `${targetUrl.origin}${targetUrl.pathname}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

/**
 * S3-compatible driver (MinIO, Supabase Storage S3 protocol, Cloudflare R2,
 * AWS S3). Browsers upload/download ciphertext directly to the bucket using
 * SigV4 pre-signed URLs, so file bytes never pass through the Node process.
 *
 * The bucket must stay PRIVATE; access is only possible through short-lived
 * URLs issued after server-side authorization.
 *
 * @param {{
 *   endpoint?: string, publicEndpoint?: string, region: string, bucket: string,
 *   accessKeyId: string, secretAccessKey: string, forcePathStyle: boolean
 * }} options
 */
export function createS3Driver(options) {
  const internalEndpoint = options.endpoint || 'https://s3.amazonaws.com';
  const publicEndpoint = options.publicEndpoint || internalEndpoint;
  const region = options.region || 'us-east-1';
  const bucket = options.bucket;
  const accessKeyId = options.accessKeyId;
  const secretAccessKey = options.secretAccessKey;
  const forcePathStyle = Boolean(options.forcePathStyle);

  function secondsUntil(expiresAt) {
    return Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  }

  function signInternal(method, storageKey, signedHeaders = {}, extraQueryParams = {}) {
    return presignSigV4Url({
      method,
      endpoint: internalEndpoint,
      region,
      bucket,
      storageKey,
      accessKeyId,
      secretAccessKey,
      forcePathStyle,
      expiresInSeconds: 300,
      signedHeaders,
      extraQueryParams,
    });
  }

  return {
    name: 's3',

    async putObject(storageKey, buffer) {
      const url = signInternal('PUT', storageKey, {
        'content-type': 'application/octet-stream',
      });
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      });
      if (!res.ok) {
        throw new Error(`S3 putObject failed with status ${res.status}`);
      }
    },

    async stat(storageKey) {
      const url = signInternal('HEAD', storageKey);
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`S3 stat failed with status ${res.status}`);
      }
      return { sizeBytes: Number(res.headers.get('content-length') ?? 0) };
    },

    async openRead(storageKey) {
      const url = signInternal('GET', storageKey);
      const res = await fetch(url, { method: 'GET' });
      if (res.status === 404) return null;
      if (!res.ok || !res.body) {
        throw new Error(`S3 openRead failed with status ${res.status}`);
      }
      return {
        stream: Readable.fromWeb(res.body),
        sizeBytes: Number(res.headers.get('content-length') ?? 0),
      };
    },

    async deleteObject(storageKey) {
      const url = signInternal('DELETE', storageKey);
      await fetch(url, { method: 'DELETE' }).catch(() => {});
    },

    async createUploadUrl({ storageKey, sizeBytes, expiresAt }) {
      const url = presignSigV4Url({
        method: 'PUT',
        endpoint: publicEndpoint,
        region,
        bucket,
        storageKey,
        accessKeyId,
        secretAccessKey,
        forcePathStyle,
        expiresInSeconds: secondsUntil(expiresAt),
        signedHeaders: {
          'content-type': 'application/octet-stream',
          'content-length': sizeBytes,
        },
      });
      return {
        url,
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
      };
    },

    async createDownloadUrl({ storageKey, expiresAt }) {
      const url = presignSigV4Url({
        method: 'GET',
        endpoint: publicEndpoint,
        region,
        bucket,
        storageKey,
        accessKeyId,
        secretAccessKey,
        forcePathStyle,
        expiresInSeconds: secondsUntil(expiresAt),
        extraQueryParams: {
          'response-content-type': 'application/octet-stream',
          'response-cache-control': 'no-store',
        },
      });
      return { url };
    },
  };
}

