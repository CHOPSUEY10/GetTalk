import env from '../../config/env.js';
import { createLocalDriver } from './local.driver.js';

/**
 * Storage driver factory. The S3 SDK is only loaded when STORAGE_DRIVER=s3,
 * so local development and tests do not pay its startup cost.
 *
 * Driver interface:
 *   putObject(key, buffer)
 *   stat(key)                       -> { sizeBytes } | null
 *   openRead(key)                   -> { stream, sizeBytes } | null
 *   deleteObject(key)
 *   createUploadUrl({ attachmentId, storageKey, sizeBytes, expiresAt })
 *                                   -> { url, method, headers }
 *   createDownloadUrl({ attachmentId, storageKey, expiresAt }) -> { url }
 */

let driverPromise = null;

export function getStorageDriver() {
  if (!driverPromise) {
    driverPromise = (async () => {
      if (env.storage.driver === 's3') {
        const { createS3Driver } = await import('./s3.driver.js');
        return createS3Driver(env.storage.s3);
      }
      return createLocalDriver({
        storageDir: env.storageDir,
        urlSigningSecret: env.storage.urlSigningSecret,
      });
    })();
  }
  return driverPromise;
}

/** Expiry timestamp for a newly issued pre-signed URL. */
export function presignedUrlExpiry() {
  return new Date(Date.now() + env.storage.urlTtlSeconds * 1000);
}

