/**
 * HKDF-SHA-256 key derivation for deriving AES-256-GCM keys from shared secrets.
 * (Issue #5 — E2EE crypto layer)
 */

/**
 * Derive an AES-256-GCM encryption key from raw shared secret bits using HKDF.
 *
 * @param {ArrayBuffer} sharedSecret - Raw shared secret from ECDH deriveBits
 * @param {Uint8Array | ArrayBuffer} [salt] - Optional salt (defaults to empty)
 * @param {string} [info='gettalk-e2ee'] - Context/info string for HKDF
 * @returns {Promise<CryptoKey>} AES-256-GCM key
 */
export async function deriveEncryptionKey(sharedSecret, salt, info = 'gettalk-e2ee') {
  // Import the shared secret as HKDF base key material
  const baseKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  const encoder = new TextEncoder();
  const infoBytes = encoder.encode(info);
  const saltBytes = salt
    ? (salt instanceof Uint8Array ? salt : new Uint8Array(salt))
    : new Uint8Array(0);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: infoBytes,
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false, // non-extractable derived key
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive raw key bytes from shared secret using HKDF.
 * Useful when you need the raw bytes rather than a CryptoKey.
 *
 * @param {ArrayBuffer} sharedSecret
 * @param {Uint8Array | ArrayBuffer} [salt]
 * @param {string} [info='gettalk-e2ee']
 * @param {number} [lengthBits=256]
 * @returns {Promise<ArrayBuffer>}
 */
export async function deriveRawBits(sharedSecret, salt, info = 'gettalk-e2ee', lengthBits = 256) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );

  const encoder = new TextEncoder();
  const infoBytes = encoder.encode(info);
  const saltBytes = salt
    ? (salt instanceof Uint8Array ? salt : new Uint8Array(salt))
    : new Uint8Array(0);

  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: infoBytes,
    },
    baseKey,
    lengthBits
  );
}
