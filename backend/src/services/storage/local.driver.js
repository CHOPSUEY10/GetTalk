import { createReadStream } from 'node:fs';
import { mkdir, writeFile, stat, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createToken } from './signed-token.js';

/**
 * Local filesystem driver. Pre-signed URLs point back at this backend
 * (`/api/storage/:token`) and are served by storage.controller.js.
 *
 * @param {{ storageDir: string, urlSigningSecret: string }} options
 */
export function createLocalDriver({ storageDir, urlSigningSecret }) {
  const storageRoot = resolve(storageDir);

  /** Resolve a storage key and refuse anything escaping the storage root. */
  function pathFor(storageKey) {
    const filePath = resolve(storageRoot, storageKey);
    if (!filePath.startsWith(storageRoot + sep)) {
      throw new Error('Invalid storage key');
    }
    return filePath;
  }

  return {
    name: 'local',

    async putObject(storageKey, buffer) {
      const filePath = pathFor(storageKey);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, buffer);
    },

    /** @returns {Promise<{ sizeBytes: number } | null>} */
    async stat(storageKey) {
      try {
        const info = await stat(pathFor(storageKey));
        return info.isFile() ? { sizeBytes: info.size } : null;
      } catch {
        return null;
      }
    },

    /** @returns {Promise<{ stream: import('node:stream').Readable, sizeBytes: number } | null>} */
    async openRead(storageKey) {
      const info = await this.stat(storageKey);
      if (!info) return null;
      return { stream: createReadStream(pathFor(storageKey)), sizeBytes: info.sizeBytes };
    },

    async deleteObject(storageKey) {
      await unlink(pathFor(storageKey)).catch(() => {});
    },

    async createUploadUrl({ attachmentId, expiresAt }) {
      const token = createToken(urlSigningSecret, { attachmentId, op: 'put', expiresAt });
      return {
        // Relative to the API base URL; the frontend prefixes VITE_API_URL.
        url: `/api/storage/${token}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
      };
    },

    async createDownloadUrl({ attachmentId, expiresAt }) {
      const token = createToken(urlSigningSecret, { attachmentId, op: 'get', expiresAt });
      return { url: `/api/storage/${token}` };
    },
  };
}

