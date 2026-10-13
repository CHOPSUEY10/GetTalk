/**
 * AES-256-GCM encryption and decryption for message payloads and file data.
 * (Issue #5 — E2EE crypto layer)
 *
 * Uses 96-bit (12-byte) random nonce per encryption operation as recommended
 * by NIST SP 800-38D for GCM.
 */

const NONCE_LENGTH = 12; // 96 bits

/**
 * Encrypt plaintext string with AES-256-GCM.
 *
 * @param {CryptoKey} key - AES-256-GCM key
 * @param {string} plaintext - Text to encrypt
 * @returns {Promise<{ ciphertext: ArrayBuffer, nonce: Uint8Array }>}
 */
export async function encryptText(key, plaintext) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  return encrypt(key, data);
}

/**
 * Decrypt ciphertext back to plaintext string with AES-256-GCM.
 *
 * @param {CryptoKey} key - AES-256-GCM key
 * @param {ArrayBuffer} ciphertext
 * @param {Uint8Array} nonce
 * @returns {Promise<string>}
 */
export async function decryptText(key, ciphertext, nonce) {
  const data = await decrypt(key, ciphertext, nonce);
  const decoder = new TextDecoder();
  return decoder.decode(data);
}

/**
 * Encrypt raw bytes with AES-256-GCM.
 *
 * @param {CryptoKey} key - AES-256-GCM key
 * @param {ArrayBuffer | Uint8Array} data - Raw data to encrypt
 * @returns {Promise<{ ciphertext: ArrayBuffer, nonce: Uint8Array }>}
 */
export async function encrypt(key, data) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
    },
    key,
    data
  );

  return { ciphertext, nonce };
}

/**
 * Decrypt raw bytes with AES-256-GCM.
 *
 * @param {CryptoKey} key - AES-256-GCM key
 * @param {ArrayBuffer} ciphertext
 * @param {Uint8Array} nonce
 * @returns {Promise<ArrayBuffer>}
 */
export async function decrypt(key, ciphertext, nonce) {
  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
    },
    key,
    ciphertext
  );
}

// ── Base64URL serialization helpers ────────────────────────────

/**
 * Encode ciphertext ArrayBuffer to Base64URL string.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode Base64URL string back to ArrayBuffer.
 * @param {string} base64url
 * @returns {ArrayBuffer}
 */
export function fromBase64Url(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Encode nonce Uint8Array to Base64URL string.
 * @param {Uint8Array} nonce
 * @returns {string}
 */
export function nonceToBase64Url(nonce) {
  return toBase64Url(nonce.buffer);
}

/**
 * Decode Base64URL nonce string to Uint8Array.
 * @param {string} base64url
 * @returns {Uint8Array}
 */
export function nonceFromBase64Url(base64url) {
  return new Uint8Array(fromBase64Url(base64url));
}
