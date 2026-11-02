import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
  const base = {
    region: options.region,
    forcePathStyle: options.forcePathStyle,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    // Newer SDKs add CRC32 checksum params to PutObject by default, which
    // breaks browser uploads through pre-signed URLs on MinIO/Supabase/R2.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };

  // Server-side operations use the internal endpoint; URLs handed to
  // browsers are signed for the public endpoint (the host is signed).
  const client = new S3Client({ ...base, endpoint: options.endpoint });
  const presignClient =
    options.publicEndpoint && options.publicEndpoint !== options.endpoint
      ? new S3Client({ ...base, endpoint: options.publicEndpoint })
      : client;

  const Bucket = options.bucket;

  function secondsUntil(expiresAt) {
    return Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  }

  return {
    name: 's3',

    async putObject(storageKey, buffer) {
      await client.send(new PutObjectCommand({
        Bucket,
        Key: storageKey,
        Body: buffer,
        ContentType: 'application/octet-stream',
      }));
    },

    async stat(storageKey) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key: storageKey }));
        return { sizeBytes: Number(head.ContentLength ?? 0) };
      } catch (err) {
        if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async openRead(storageKey) {
      try {
        const obj = await client.send(new GetObjectCommand({ Bucket, Key: storageKey }));
        return { stream: obj.Body, sizeBytes: Number(obj.ContentLength ?? 0) };
      } catch (err) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async deleteObject(storageKey) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: storageKey })).catch(() => {});
    },

    async createUploadUrl({ storageKey, sizeBytes, expiresAt }) {
      const command = new PutObjectCommand({
        Bucket,
        Key: storageKey,
        ContentType: 'application/octet-stream',
        ContentLength: sizeBytes,
      });
      // Signing Content-Length makes the store reject bodies whose size
      // differs from the declared size; /complete re-checks it anyway.
      const url = await getSignedUrl(presignClient, command, {
        expiresIn: secondsUntil(expiresAt),
        signableHeaders: new Set(['content-type', 'content-length']),
      });
      return {
        url,
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
      };
    },

    async createDownloadUrl({ storageKey, expiresAt }) {
      const command = new GetObjectCommand({
        Bucket,
        Key: storageKey,
        ResponseContentType: 'application/octet-stream',
        ResponseCacheControl: 'no-store',
      });
      const url = await getSignedUrl(presignClient, command, {
        expiresIn: secondsUntil(expiresAt),
      });
      return { url };
    },
  };
}

