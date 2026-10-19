/**
 * Client-side file encryption before upload.
 * (Issue #6 — Attachment encryption; issue #15 — metadata privacy)
 *
 * Encrypts files using AES-256-GCM with a random per-file key.
 * The per-file key and the file metadata (name, MIME type, size) are
 * encrypted with the conversation's derived key, so the server only stores
 * opaque ciphertext. Size of the encrypted blob remains visible to the
 * server because ciphertext length is inherently observable.
 *
 * Flow:
 *   Plaintext file + metadata
 *     ↓ (client only)
 *   Generate random fileKey (AES-256-GCM)
 *   Encrypt file with fileKey → encryptedBlob
 *   Encrypt fileKey with conversationKey → encryptedFileKey
 *   Encrypt metadata JSON with conversationKey → metadataCiphertext
 *     ↓
 *   Upload ciphertexts + nonces to backend
 */

import { encrypt, decrypt, toBase64Url, fromBase64Url, nonceToBase64Url, nonceFromBase64Url } from './aes-gcm.js';
import { getConversationKey } from './message-crypto.js';

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
 * @typedef {Object} EncryptedFile
 * @property {Blob} encryptedBlob - Encrypted file content
 * @property {string} fileNonce - Base64URL nonce used for file encryption
 * @property {string} encryptedFileKey - Base64URL encrypted file key (wrapped with conversation key)
 * @property {string} keyNonce - Base64URL nonce used for key wrapping
 * @property {string} metadataCiphertext - Base64URL encrypted metadata JSON
 * @property {string} metadataNonce - Base64URL nonce used for metadata encryption
 * @property {number} encryptedSize - Byte length of the encrypted payload
 */

/**
 * Encrypt a file and its metadata for upload.
 *
 * @param {File} file - The file to encrypt
 * @param {string} conversationId - Conversation this file belongs to
 * @returns {Promise<EncryptedFile>}
 */
export async function encryptFile(file, conversationId) {
  const conversationKey = await getConversationKey(conversationId);

  // Read file content
  const fileData = await file.arrayBuffer();

  // Generate random per-file key
  const fileKey = await generateFileKey();

  // Encrypt file content with file key
  const { ciphertext: encryptedContent, nonce: fileNonce } = await encrypt(fileKey, fileData);

  // Wrap (encrypt) the file key with the conversation key
  const rawFileKey = await exportKeyRaw(fileKey);
  const { ciphertext: wrappedKey, nonce: keyNonce } = await encrypt(conversationKey, rawFileKey);

  // Encrypt metadata so filename/MIME type never reach the server in plaintext
  const metadata = JSON.stringify({
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
  });
  const { ciphertext: encryptedMetadata, nonce: metadataNonce } = await encrypt(
    conversationKey,
    new TextEncoder().encode(metadata)
  );

  return {
    encryptedBlob: new Blob([encryptedContent], { type: 'application/octet-stream' }),
    fileNonce: nonceToBase64Url(fileNonce),
    encryptedFileKey: toBase64Url(wrappedKey),
    keyNonce: nonceToBase64Url(keyNonce),
    metadataCiphertext: toBase64Url(encryptedMetadata),
    metadataNonce: nonceToBase64Url(metadataNonce),
    encryptedSize: encryptedContent.byteLength,
  };
}

/**
 * Decrypt a downloaded encrypted file and its metadata.
 *
 * @param {ArrayBuffer} encryptedContent - Encrypted file bytes
 * @param {string} fileNonceBase64 - Base64URL nonce for file decryption
 * @param {string} encryptedFileKeyBase64 - Base64URL wrapped file key
 * @param {string} keyNonceBase64 - Base64URL nonce for key unwrapping
 * @param {string} conversationId
 * @param {string} metadataCiphertextBase64 - Base64URL encrypted metadata JSON
 * @param {string} metadataNonceBase64 - Base64URL nonce for metadata decryption
 * @returns {Promise<{ blob: Blob, name: string, type: string, size: number }>}
 */
export async function decryptFile(
  encryptedContent,
  fileNonceBase64,
  encryptedFileKeyBase64,
  keyNonceBase64,
  conversationId,
  metadataCiphertextBase64,
  metadataNonceBase64
) {
  const conversationKey = await getConversationKey(conversationId);

  // Unwrap the file key
  const wrappedKeyBytes = fromBase64Url(encryptedFileKeyBase64);
  const keyNonce = nonceFromBase64Url(keyNonceBase64);
  const rawFileKey = await decrypt(conversationKey, wrappedKeyBytes, keyNonce);

  // Import the unwrapped file key
  const fileKey = await importKeyRaw(rawFileKey);

  // Decrypt the file content
  const fileNonce = nonceFromBase64Url(fileNonceBase64);
  const decryptedContent = await decrypt(fileKey, encryptedContent, fileNonce);

  // Decrypt the metadata
  const metadataBytes = await decrypt(
    conversationKey,
    fromBase64Url(metadataCiphertextBase64),
    nonceFromBase64Url(metadataNonceBase64)
  );
  const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));

  return {
    blob: new Blob([decryptedContent], { type: metadata.type || 'application/octet-stream' }),
    name: metadata.name,
    type: metadata.type || 'application/octet-stream',
    size: metadata.size,
  };
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
