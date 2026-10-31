/**
 * Client-side file encryption before upload (issues #6, #15).
 *
 * The file body is encrypted with a random per-file AES-256-GCM key. That
 * key and the file metadata (name, MIME type, size) are wrapped inside one
 * encrypted metadata blob with the conversation key. The server stores only:
 *   - encrypted file bytes
 *   - metadataCiphertext / metadataNonce
 *   - the ciphertext length
 *
 * Flow:
 *   Plaintext file + metadata
 *     ↓ (client only)
 *   fileKey → encrypt(file) → encryptedBlob
 *   conversationKey → encrypt(fileKey + metadata) → metadataCiphertext
 *     ↓
 *   Upload binary body + metadata headers
 */

import { encrypt, decrypt, toBase64Url, fromBase64Url, nonceToBase64Url, nonceFromBase64Url } from './aes-gcm.js';
import { getConversationKey } from './message-crypto.js';
import {
  ENCRYPTION_ERROR_CODES,
  EncryptionError,
  handleEncryptionError,
} from '../../errors/encryptionerror.js';

/**
 * @returns {Promise<CryptoKey>}
 */
async function generateFileKey() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can wrap it with the conversation key
    ['encrypt', 'decrypt']
  );
}

/**
 * @param {CryptoKey} key
 * @returns {Promise<ArrayBuffer>}
 */
async function exportKeyRaw(key) {
  return crypto.subtle.exportKey('raw', key);
}

/**
 * @param {ArrayBuffer} raw
 * @returns {Promise<CryptoKey>}
 */
async function importKeyRaw(raw) {
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * @typedef {Object} EncryptedFile
 * @property {Blob} encryptedBlob - Encrypted file content
 * @property {string} metadataCiphertext - Base64URL encrypted metadata JSON
 * @property {string} metadataNonce - Base64URL nonce used for metadata encryption
 * @property {number} encryptedSize - Byte length of the encrypted payload
 */

/**
 * Encrypt a file and its metadata for upload.
 *
 * @param {File} file
 * @param {string} conversationId
 * @returns {Promise<EncryptedFile>}
 */
export async function encryptFile(file, conversationId) {
  const conversationKey = await getConversationKey(conversationId);

  try {
    const fileData = await file.arrayBuffer();
    const fileKey = await generateFileKey();

    // Encrypt file content with the per-file key.
    const { ciphertext: encryptedContent, nonce: fileNonce } = await encrypt(fileKey, fileData);

    // Wrap the file key with the conversation key.
    const rawFileKey = await exportKeyRaw(fileKey);
    const { ciphertext: wrappedKey, nonce: keyNonce } = await encrypt(conversationKey, rawFileKey);

    // One encrypted metadata blob carries the filename, MIME type, size, and
    // everything needed to unwrap/decrypt the file.
    const metadata = JSON.stringify({
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      fileNonce: nonceToBase64Url(fileNonce),
      encryptedFileKey: toBase64Url(wrappedKey),
      keyNonce: nonceToBase64Url(keyNonce),
    });
    const { ciphertext: encryptedMetadata, nonce: metadataNonce } = await encrypt(
      conversationKey,
      new TextEncoder().encode(metadata)
    );

    return {
      encryptedBlob: new Blob([encryptedContent], { type: 'application/octet-stream' }),
      metadataCiphertext: toBase64Url(encryptedMetadata),
      metadataNonce: nonceToBase64Url(metadataNonce),
      encryptedSize: encryptedContent.byteLength,
    };
  } catch (err) {
    if (err instanceof EncryptionError) {
      throw err;
    }
    throw handleEncryptionError(err, {
      code: ENCRYPTION_ERROR_CODES.ENCRYPTION_FAILED,
      operation: 'file-encrypt',
      conversationId,
      message: 'Failed to encrypt file attachment',
    });
  }
}

/**
 * Decrypt a downloaded encrypted file and its metadata.
 *
 * @param {ArrayBuffer | Uint8Array} encryptedContent
 * @param {string} conversationId
 * @param {string} metadataCiphertextBase64
 * @param {string} metadataNonceBase64
 * @returns {Promise<{ blob: Blob, name: string, type: string, size: number }>}
 */
export async function decryptFile(
  encryptedContent,
  conversationId,
  metadataCiphertextBase64,
  metadataNonceBase64
) {
  const conversationKey = await getConversationKey(conversationId);

  try {
    // Decrypt the metadata (filename, MIME type, wrapped file key, nonces).
    const metadataBytes = await decrypt(
      conversationKey,
      fromBase64Url(metadataCiphertextBase64),
      nonceFromBase64Url(metadataNonceBase64)
    );
    const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));

    // Unwrap and import the per-file key.
    const rawFileKey = await decrypt(
      conversationKey,
      fromBase64Url(metadata.encryptedFileKey),
      nonceFromBase64Url(metadata.keyNonce)
    );
    const fileKey = await importKeyRaw(rawFileKey);

    // Decrypt the file content.
    const decryptedContent = await decrypt(
      fileKey,
      encryptedContent,
      nonceFromBase64Url(metadata.fileNonce)
    );

    return {
      blob: new Blob([decryptedContent], { type: metadata.type || 'application/octet-stream' }),
      name: metadata.name,
      type: metadata.type || 'application/octet-stream',
      size: metadata.size,
    };
  } catch (err) {
    if (err instanceof EncryptionError) {
      throw err;
    }
    throw handleEncryptionError(err, {
      code: ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED,
      operation: 'file-decrypt',
      conversationId,
      message: 'Failed to decrypt file attachment',
    });
  }
}

/**
 * Create a downloadable Object URL from a decrypted Blob.
 *
 * @param {Blob} blob
 * @returns {string} Object URL (remember to revoke when done)
 */
export function createDownloadUrl(blob) {
  return URL.createObjectURL(blob);
}
