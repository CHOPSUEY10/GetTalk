/**
 * Client-side file encryption before upload (Rule §21, API contract §10).
 *
 * Encrypts files using AES-256-GCM with a random per-file key.
 * The per-file key is then encrypted with the conversation's derived key
 * so that only conversation members can decrypt the file.
 *
 * Flow:
 *   Plaintext file
 *     ↓ (client only)
 *   Generate random fileKey (AES-256-GCM)
 *   Encrypt file with fileKey → encryptedBlob
 *   Encrypt fileKey with conversationKey → encryptedFileKey
 *     ↓
 *   Upload encryptedBlob + encryptedFileKey + nonces to backend
 */

import { encrypt, decrypt, toBase64Url, fromBase64Url, nonceToBase64Url, nonceFromBase64Url } from './aes-gcm.js';
import { ensureConversationKey } from './message-crypto.js';
import { getDerivedKey } from './key-store.js';

/**
 * Generate a random AES-256-GCM key for encrypting a single file.
 *
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
 * Export a CryptoKey to raw bytes.
 *
 * @param {CryptoKey} key
 * @returns {Promise<ArrayBuffer>}
 */
async function exportKeyRaw(key) {
  return crypto.subtle.exportKey('raw', key);
}

/**
 * Import raw key bytes as an AES-256-GCM CryptoKey.
 *
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
 * Calculate hex SHA-256 checksum of an ArrayBuffer.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>}
 */
async function computeChecksum(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @typedef {Object} EncryptedFile
 * @property {Blob} encryptedBlob - Encrypted file content
 * @property {string} fileNonce - Base64URL nonce used for file encryption
 * @property {string} encryptedFileKey - Base64URL encrypted file key (wrapped with conversation key)
 * @property {string} keyNonce - Base64URL nonce used for key wrapping
 * @property {string} checksum - Hex SHA-256 checksum of the plaintext file
 * @property {string} originalName - Original filename
 * @property {string} mimeType - Original MIME type
 * @property {number} originalSize - Original file size in bytes
 */

/**
 * Encrypt a file for upload on client side before transmission (Rule §21).
 *
 * @param {File} file - The file to encrypt
 * @param {string} conversationId - Conversation this file belongs to
 * @param {string} [ownUserId='me']
 * @param {string | null} [peerUserId=null]
 * @returns {Promise<EncryptedFile>}
 */
export async function encryptFile(file, conversationId, ownUserId = 'me', peerUserId = null) {
  const conversationKey = await ensureConversationKey(conversationId, ownUserId, peerUserId);

  // Read file content
  const fileData = await file.arrayBuffer();

  // Compute checksum for data integrity validation
  const checksum = await computeChecksum(fileData);

  // Generate random per-file key
  const fileKey = await generateFileKey();

  // Encrypt file content with file key
  const { ciphertext: encryptedContent, nonce: fileNonce } = await encrypt(fileKey, fileData);

  // Wrap (encrypt) the file key with the conversation key
  const rawFileKey = await exportKeyRaw(fileKey);
  const { ciphertext: wrappedKey, nonce: keyNonce } = await encrypt(conversationKey, rawFileKey);

  return {
    encryptedBlob: new Blob([encryptedContent], { type: 'application/octet-stream' }),
    fileNonce: nonceToBase64Url(fileNonce),
    encryptedFileKey: toBase64Url(wrappedKey),
    keyNonce: nonceToBase64Url(keyNonce),
    checksum,
    originalName: file.name,
    mimeType: file.type || 'application/octet-stream',
    originalSize: file.size,
  };
}

/**
 * Decrypt a downloaded encrypted file.
 *
 * @param {ArrayBuffer} encryptedContent - Encrypted file bytes
 * @param {string} fileNonceBase64 - Base64URL nonce for file decryption
 * @param {string} encryptedFileKeyBase64 - Base64URL wrapped file key
 * @param {string} keyNonceBase64 - Base64URL nonce for key unwrapping
 * @param {string} conversationId
 * @param {string} [mimeType='application/octet-stream']
 * @returns {Promise<Blob>} Decrypted file as Blob
 */
export async function decryptFile(
  encryptedContent,
  fileNonceBase64,
  encryptedFileKeyBase64,
  keyNonceBase64,
  conversationId,
  mimeType = 'application/octet-stream'
) {
  const derivedId = `derived:${conversationId}`;
  const conversationKey = await getDerivedKey(derivedId);

  if (!conversationKey) {
    throw new Error(
      `No encryption key established for conversation ${conversationId}.`
    );
  }

  // Unwrap the file key
  const wrappedKeyBytes = fromBase64Url(encryptedFileKeyBase64);
  const keyNonce = nonceFromBase64Url(keyNonceBase64);
  const rawFileKey = await decrypt(conversationKey, wrappedKeyBytes, keyNonce);

  // Import the unwrapped file key
  const fileKey = await importKeyRaw(rawFileKey);

  // Decrypt the file content
  const fileNonce = nonceFromBase64Url(fileNonceBase64);
  const decryptedContent = await decrypt(fileKey, encryptedContent, fileNonce);

  return new Blob([decryptedContent], { type: mimeType });
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
