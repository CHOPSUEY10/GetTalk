/**
 * High-level message encryption/decryption wrapper.
 * (Issue #5 — E2EE crypto layer)
 *
 * Integrates ECDH key exchange, HKDF derivation, AES-256-GCM encryption,
 * and IndexedDB key storage into a simple API for the message stores.
 */

import { generateKeyPair, exportPublicKeyBase64, importPublicKeyBase64, deriveSharedSecret } from './ecdh.js';
import { deriveEncryptionKey } from './hkdf.js';
import { encryptText, decryptText, toBase64Url, fromBase64Url, nonceToBase64Url, nonceFromBase64Url } from './aes-gcm.js';
import { storeKeyPair, getKeyPair, storeDerivedKey, getDerivedKey, clearAll } from './key-store.js';

/**
 * Active derived-key id per conversation.
 *
 * The id includes the peer fingerprint so a rotated peer key never silently
 * reuses a stale conversation key.
 * @type {Map<string, string>}
 */
const activeDerivedIds = new Map();

/**
 * Get or create the user's ECDH key pair.
 * The key pair is persisted in IndexedDB under `user:<userId>`.
 *
 * @param {string} userId
 * @returns {Promise<{ privateKey: CryptoKey, publicKey: CryptoKey, publicKeyBase64: string }>}
 */
export async function getOrCreateIdentityKeyPair(userId) {
  const storeId = `user:${userId}`;
  let existing = await getKeyPair(storeId);

  if (!existing) {
    const keyPair = await generateKeyPair();
    await storeKeyPair(storeId, keyPair);
    existing = { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey, createdAt: Date.now() };
  }

  const publicKeyBase64 = await exportPublicKeyBase64(existing.publicKey);
  return {
    privateKey: existing.privateKey,
    publicKey: existing.publicKey,
    publicKeyBase64,
  };
}

/**
 * Establish a shared encryption key for a conversation with a peer.
 *
 * Performs ECDH key exchange using own private key + peer's public key,
 * then derives an AES-256-GCM key via HKDF. The derived key is cached
 * in IndexedDB for subsequent encrypt/decrypt calls.
 *
 * @param {string} conversationId
 * @param {CryptoKey} ownPrivateKey
 * @param {string} peerPublicKeyBase64 - Peer's public key as Base64URL
 * @param {string} peerFingerprint - Locally computed fingerprint of the peer key
 * @returns {Promise<CryptoKey>} AES-256-GCM key for the conversation
 */
export async function establishConversationKey(conversationId, ownPrivateKey, peerPublicKeyBase64, peerFingerprint) {
  if (!peerPublicKeyBase64 || !peerFingerprint) {
    throw new Error(
      'Cannot establish a conversation key without the peer public key and fingerprint.'
    );
  }

  const derivedId = `derived:${conversationId}:${peerFingerprint}`;
  activeDerivedIds.set(conversationId, derivedId);

  // Check cache first
  const cached = await getDerivedKey(derivedId);
  if (cached) return cached;

  // Perform ECDH key exchange
  const peerPublicKey = await importPublicKeyBase64(peerPublicKeyBase64);
  const sharedSecret = await deriveSharedSecret(ownPrivateKey, peerPublicKey);

  // Derive AES-256-GCM key from shared secret via HKDF
  const encryptionKey = await deriveEncryptionKey(sharedSecret);

  // Cache the derived key
  await storeDerivedKey(derivedId, encryptionKey);

  return encryptionKey;
}

/**
 * @param {string} conversationId
 * @returns {string}
 */
function activeDerivedId(conversationId) {
  const derivedId = activeDerivedIds.get(conversationId);
  if (!derivedId) {
    throw new Error(
      `No encryption key established for conversation ${conversationId}. ` +
      'Call establishConversationKey() first.'
    );
  }
  return derivedId;
}

/**
 * Get the active derived conversation key, if a session is established.
 * Used by other payload types (e.g. attachment encryption) so they never
 * derive keys from public identifiers.
 *
 * @param {string} conversationId
 * @returns {Promise<CryptoKey>}
 */
export async function getConversationKey(conversationId) {
  const key = await getDerivedKey(activeDerivedId(conversationId));
  if (!key) {
    throw new Error(
      `No encryption key established for conversation ${conversationId}.`
    );
  }
  return key;
}

/**
 * Encrypt a message for sending.
 *
 * @param {string} conversationId
 * @param {string} plaintext - Message text to encrypt
 * @returns {Promise<{ bodyCiphertext: string, nonce: string }>}
 *   Base64URL-encoded ciphertext and nonce ready for the API contract.
 */
export async function encryptMessage(conversationId, plaintext) {
  const key = await getDerivedKey(activeDerivedId(conversationId));

  if (!key) {
    throw new Error(
      `No encryption key established for conversation ${conversationId}. ` +
      'Call establishConversationKey() first.'
    );
  }

  const { ciphertext, nonce } = await encryptText(key, plaintext);

  return {
    bodyCiphertext: toBase64Url(ciphertext),
    nonce: nonceToBase64Url(nonce),
  };
}

/**
 * Decrypt a received message.
 *
 * @param {string} conversationId
 * @param {string} bodyCiphertextBase64 - Base64URL-encoded ciphertext
 * @param {string} nonceBase64 - Base64URL-encoded nonce
 * @returns {Promise<string>} Decrypted plaintext
 */
export async function decryptMessage(conversationId, bodyCiphertextBase64, nonceBase64) {
  const key = await getDerivedKey(activeDerivedId(conversationId));

  if (!key) {
    throw new Error(
      `No encryption key established for conversation ${conversationId}. ` +
      'Key exchange required before decryption.'
    );
  }

  const ciphertext = fromBase64Url(bodyCiphertextBase64);
  const nonce = nonceFromBase64Url(nonceBase64);

  return decryptText(key, ciphertext, nonce);
}

/**
 * Clear all local crypto keys (e.g., on logout).
 *
 * @returns {Promise<void>}
 */
export async function clearCryptoState() {
  activeDerivedIds.clear();
  await clearAll();
}
