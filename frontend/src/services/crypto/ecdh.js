/**
 * ECDH P-256 key pair generation and key exchange via Web Crypto API.
 * (Issue #5 — E2EE crypto layer)
 *
 * All private keys are generated as non-extractable to prevent exfiltration.
 */

/**
 * Generate an ECDH P-256 key pair.
 * The private key is non-extractable for security.
 *
 * @returns {Promise<CryptoKeyPair>}
 */
export async function generateKeyPair() {
  return crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    false, // non-extractable private key
    ['deriveKey', 'deriveBits']
  );
}

/**
 * Export a public key to raw bytes for transmission/storage.
 *
 * @param {CryptoKey} publicKey
 * @returns {Promise<ArrayBuffer>}
 */
export async function exportPublicKey(publicKey) {
  return crypto.subtle.exportKey('raw', publicKey);
}

/**
 * Import a raw public key from bytes received from a peer.
 *
 * @param {ArrayBuffer} rawKey
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(rawKey) {
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true, // public keys can be extractable
    []
  );
}

/**
 * Derive shared secret bits from own private key and peer's public key.
 *
 * @param {CryptoKey} privateKey - Own ECDH private key
 * @param {CryptoKey} peerPublicKey - Peer's ECDH public key
 * @returns {Promise<ArrayBuffer>} 256-bit shared secret
 */
export async function deriveSharedSecret(privateKey, peerPublicKey) {
  return crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: peerPublicKey,
    },
    privateKey,
    256 // 256 bits
  );
}

/**
 * Export a public key as Base64URL string for JSON serialization.
 *
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>}
 */
export async function exportPublicKeyBase64(publicKey) {
  const raw = await exportPublicKey(publicKey);
  return arrayBufferToBase64Url(raw);
}

/**
 * Import a public key from a Base64URL string.
 *
 * @param {string} base64url
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKeyBase64(base64url) {
  const raw = base64UrlToArrayBuffer(base64url);
  return importPublicKey(raw);
}

// ── Base64URL helpers ──────────────────────────────────────────

/**
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} base64url
 * @returns {ArrayBuffer}
 */
function base64UrlToArrayBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
