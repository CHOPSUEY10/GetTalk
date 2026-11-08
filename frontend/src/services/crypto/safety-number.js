/**
 * Deterministic Safety Number derivation (60 digits / 12x5 blocks) and
 * local QR Code generation for out-of-band identity verification (Rule #17, NFR-15, AC-17).
 *
 * Security invariants (Rule #8, #16, #17, #34):
 *  - Uses Web Crypto API (`crypto.subtle.digest('SHA-512', ...)` and `'SHA-256'`).
 *  - Never accepts, exports, or embeds private keys.
 *  - Derives Safety Numbers symmetrically by sorting both parties' public keys
 *    lexicographically before hashing.
 *  - Generates QR Code SVG locally without external network requests or third-party trackers.
 */

import { exportPublicKeyBase64 } from './ecdh.js';
import { toBase64Url, fromBase64Url } from './aes-gcm.js';

export const SAFETY_NUMBER_BLOCK_COUNT = 12;
export const SAFETY_NUMBER_BLOCK_SIZE = 5;
export const SAFETY_NUMBER_TOTAL_DIGITS = SAFETY_NUMBER_BLOCK_COUNT * SAFETY_NUMBER_BLOCK_SIZE; // 60
export const QR_PAYLOAD_PREFIX = 'GETTALK-SN:v1';

/**
 * Normalize a public key input (Base64URL string, ArrayBuffer, Uint8Array, CryptoKey,
 * or `{ publicKey, userId }` wrapper) into `{ canonicalKey: string, rawBytes: Uint8Array<ArrayBuffer>, userId?: string }`.
 *
 * Strictly rejects any private CryptoKey to prevent accidental secret leakage (Rule #17).
 *
 * @param {string | ArrayBuffer | Uint8Array | CryptoKey | { publicKey: any, userId?: string }} input
 * @returns {Promise<{ canonicalKey: string, rawBytes: Uint8Array<ArrayBuffer>, userId?: string }>}
 */
async function normalizePublicKeyInput(input) {
  if (!input) {
    throw new Error('Public key is required to derive a Safety Number.');
  }

  let extractedUserId;
  /** @type {any} */
  let keySource = input;

  if (
    typeof input === 'object' &&
    !(input instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(input) &&
    !('type' in input && 'algorithm' in input) &&
    'publicKey' in input
  ) {
    keySource = input.publicKey;
    extractedUserId = input.userId ? String(input.userId) : undefined;
  }

  // Guard against private CryptoKey objects
  if (keySource && typeof keySource === 'object' && 'type' in keySource) {
    if (keySource.type === 'private' || keySource.type === 'secret') {
      throw new Error('Private or secret keys must never be used in Safety Number derivation.');
    }
    if (keySource.type === 'public') {
      const canonicalKey = await exportPublicKeyBase64(/** @type {CryptoKey} */ (keySource));
      const rawBytes = new Uint8Array(fromBase64Url(canonicalKey));
      return { canonicalKey, rawBytes, userId: extractedUserId };
    }
  }

  if (keySource instanceof ArrayBuffer) {
    const rawBytes = new Uint8Array(keySource);
    if (rawBytes.byteLength === 0) {
      throw new Error('Public key bytes cannot be empty.');
    }
    return {
      canonicalKey: toBase64Url(keySource),
      rawBytes,
      userId: extractedUserId,
    };
  }

  if (ArrayBuffer.isView(keySource)) {
    const view = new Uint8Array(keySource.buffer, keySource.byteOffset, keySource.byteLength);
    if (view.byteLength === 0) {
      throw new Error('Public key bytes cannot be empty.');
    }
    const copy = new Uint8Array(view);
    return {
      canonicalKey: toBase64Url(copy.buffer),
      rawBytes: copy,
      userId: extractedUserId,
    };
  }

  if (typeof keySource === 'string') {
    const trimmed = keySource.trim();
    if (!trimmed) {
      throw new Error('Public key string cannot be empty.');
    }
    try {
      const buf = fromBase64Url(trimmed);
      const rawBytes = new Uint8Array(buf);
      if (rawBytes.byteLength > 0) {
        return {
          canonicalKey: toBase64Url(buf),
          rawBytes,
          userId: extractedUserId,
        };
      }
    } catch {
      // Fallback for non-base64 test identifiers: encode UTF-8 bytes
    }
    const rawBytes = new TextEncoder().encode(trimmed);
    return {
      canonicalKey: toBase64Url(rawBytes.buffer),
      rawBytes,
      userId: extractedUserId,
    };
  }

  throw new Error('Unsupported public key format for Safety Number derivation.');
}

/**
 * Compute SHA-256 Base64URL fingerprint for raw public key bytes.
 *
 * @param {Uint8Array | ArrayBuffer} rawBytes
 * @returns {Promise<string>}
 */
export async function computePublicKeyFingerprint(rawBytes) {
  const bytes = new Uint8Array(rawBytes);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toBase64Url(digest);
}

/**
 * Convert 60 numeric digits into 12 blocks of 5 digits.
 *
 * @param {string} rawDigits
 * @returns {string[]}
 */
export function formatSafetyNumberBlocks(rawDigits) {
  const cleaned = String(rawDigits || '').replace(/\D+/g, '');
  if (cleaned.length !== SAFETY_NUMBER_TOTAL_DIGITS) {
    throw new Error(`Safety Number must contain exactly ${SAFETY_NUMBER_TOTAL_DIGITS} digits.`);
  }
  /** @type {string[]} */
  const blocks = [];
  for (let i = 0; i < SAFETY_NUMBER_TOTAL_DIGITS; i += SAFETY_NUMBER_BLOCK_SIZE) {
    blocks.push(cleaned.slice(i, i + SAFETY_NUMBER_BLOCK_SIZE));
  }
  return blocks;
}

/**
 * Convert a SHA-256 Base64URL fingerprint into 6 readable 5-digit blocks (30 digits)
 * for human-friendly visual comparison during device change alerts.
 *
 * @param {string} fingerprint
 * @returns {string[]}
 */
export function formatFingerprintBlocks(fingerprint) {
  if (!fingerprint || typeof fingerprint !== 'string') {
    return [];
  }
  let bytes;
  try {
    bytes = new Uint8Array(fromBase64Url(fingerprint.trim()));
  } catch {
    bytes = new TextEncoder().encode(fingerprint.trim());
  }

  if (bytes.length < 30) {
    const padded = new Uint8Array(30);
    padded.set(bytes.slice(0, 30));
    bytes = padded;
  }

  /** @type {string[]} */
  const blocks = [];
  for (let i = 0; i < 6; i++) {
    const offset = i * 5;
    const val =
      (BigInt(bytes[offset]) << 32n) |
      (BigInt(bytes[offset + 1]) << 24n) |
      (BigInt(bytes[offset + 2]) << 16n) |
      (BigInt(bytes[offset + 3]) << 8n) |
      BigInt(bytes[offset + 4]);
    blocks.push(Number(val % 100000n).toString().padStart(5, '0'));
  }
  return blocks;
}

/**
 * Build a structured comparison between a previous and current peer fingerprint
 * for the Device Change warning modal (Rule #17, AC-17).
 *
 * @param {string} previousFingerprint
 * @param {string} currentFingerprint
 * @returns {{
 *   previousFingerprint: string,
 *   currentFingerprint: string,
 *   previousBlocks: string[],
 *   currentBlocks: string[],
 *   changedBlockIndices: number[]
 * }}
 */
export function compareFingerprints(previousFingerprint, currentFingerprint) {
  const previousBlocks = formatFingerprintBlocks(previousFingerprint);
  const currentBlocks = formatFingerprintBlocks(currentFingerprint);
  /** @type {number[]} */
  const changedBlockIndices = [];
  const maxLen = Math.max(previousBlocks.length, currentBlocks.length);
  for (let i = 0; i < maxLen; i++) {
    if (previousBlocks[i] !== currentBlocks[i]) {
      changedBlockIndices.push(i);
    }
  }
  return {
    previousFingerprint: previousFingerprint || '',
    currentFingerprint: currentFingerprint || '',
    previousBlocks,
    currentBlocks,
    changedBlockIndices,
  };
}

/**
 * Build a compact, deterministic QR payload containing sorted user identifiers (if provided),
 * the 60-digit Safety Number, and the combined fingerprint prefix.
 *
 * @param {{
 *   rawDigits: string,
 *   combinedFingerprint: string,
 *   userAId?: string,
 *   userBId?: string
 * }} params
 * @returns {string}
 */
export function buildSafetyNumberQrPayload({
  rawDigits,
  combinedFingerprint,
  userAId,
  userBId,
}) {
  const fpShort = String(combinedFingerprint || '').slice(0, 22);
  const ids = [userAId, userBId]
    .filter((id) => typeof id === 'string' && id.trim().length > 0)
    .map((id) => String(id).trim())
    .sort();

  const identitySegment = ids.length === 2 ? `${ids[0]}:${ids[1]}` : 'peer-pair';
  return `${QR_PAYLOAD_PREFIX}:${identitySegment}:${rawDigits}:${fpShort}`;
}

/**
 * Verify a scanned/pasted QR payload or Safety Number string against the expected local Safety Number.
 *
 * @param {string} scannedInput
 * @param {{ rawDigits: string, combinedFingerprint?: string, formatted?: string } | string} expected
 * @returns {{ valid: boolean, reason: string | null }}
 */
export function verifySafetyNumberQrPayload(scannedInput, expected) {
  if (!scannedInput || typeof scannedInput !== 'string') {
    return { valid: false, reason: 'EMPTY_PAYLOAD' };
  }

  const expectedDigits =
    typeof expected === 'string'
      ? expected.replace(/\D+/g, '')
      : String(expected?.rawDigits || expected?.formatted || '').replace(/\D+/g, '');

  const expectedFpPrefix =
    typeof expected === 'object' && expected?.combinedFingerprint
      ? String(expected.combinedFingerprint).slice(0, 22)
      : null;

  const trimmed = scannedInput.trim();

  if (trimmed.startsWith(`${QR_PAYLOAD_PREFIX}:`)) {
    const parts = trimmed.split(':');
    // Format: GETTALK-SN : v1 : [user1 : user2 | peer-pair] : <60digits> : <fpShort>
    const fpPart = parts[parts.length - 1];
    const digitsPart = parts[parts.length - 2];

    if (!digitsPart || digitsPart.length !== SAFETY_NUMBER_TOTAL_DIGITS) {
      return { valid: false, reason: 'MALFORMED_QR_PAYLOAD' };
    }
    if (digitsPart !== expectedDigits) {
      return { valid: false, reason: 'SAFETY_NUMBER_MISMATCH' };
    }
    if (expectedFpPrefix && fpPart !== expectedFpPrefix) {
      return { valid: false, reason: 'FINGERPRINT_MISMATCH' };
    }
    return { valid: true, reason: null };
  }

  // Also support matching raw/formatted 60-digit number directly
  const digitsOnly = trimmed.replace(/\D+/g, '');
  if (digitsOnly.length === SAFETY_NUMBER_TOTAL_DIGITS) {
    return digitsOnly === expectedDigits
      ? { valid: true, reason: null }
      : { valid: false, reason: 'SAFETY_NUMBER_MISMATCH' };
  }

  return { valid: false, reason: 'INVALID_FORMAT' };
}

/**
 * Derive a deterministic, symmetric 60-digit Safety Number (12 blocks x 5 digits)
 * from two users' public keys using lexicographical sorting + SHA-512 (Rule #17, NFR-15, AC-17).
 *
 * @param {string | ArrayBuffer | Uint8Array | CryptoKey | { publicKey: any, userId?: string }} publicKeyA
 * @param {string | ArrayBuffer | Uint8Array | CryptoKey | { publicKey: any, userId?: string }} publicKeyB
 * @param {{ userAId?: string, userBId?: string }} [options]
 * @returns {Promise<{
 *   rawDigits: string,
 *   blocks: string[],
 *   formatted: string,
 *   combinedFingerprint: string,
 *   fingerprintA: string,
 *   fingerprintB: string,
 *   qrPayload: string
 * }>}
 */
export async function deriveSafetyNumber(publicKeyA, publicKeyB, options = {}) {
  const normA = await normalizePublicKeyInput(publicKeyA);
  const normB = await normalizePublicKeyInput(publicKeyB);

  const userAId = options.userAId || normA.userId;
  const userBId = options.userBId || normB.userId;

  // Compute individual SHA-256 fingerprints
  const [fingerprintA, fingerprintB] = await Promise.all([
    computePublicKeyFingerprint(normA.rawBytes),
    computePublicKeyFingerprint(normB.rawBytes),
  ]);

  // Sort both public keys lexicographically so User A and User B derive the exact same Safety Number
  const sortedPair = [normA, normB].sort((a, b) =>
    a.canonicalKey < b.canonicalKey ? -1 : a.canonicalKey > b.canonicalKey ? 1 : 0
  );

  const firstBytes = sortedPair[0].rawBytes;
  const secondBytes = sortedPair[1].rawBytes;

  // Domain-separated buffer: [0x01, 'G', 'T', 'S', 'N', len1(2B), ...firstBytes, 0xff, len2(2B), ...secondBytes]
  const header = new Uint8Array([
    0x01,
    0x47,
    0x54,
    0x53,
    0x4e,
    (firstBytes.length >> 8) & 0xff,
    firstBytes.length & 0xff,
  ]);
  const separator = new Uint8Array([
    0xff,
    (secondBytes.length >> 8) & 0xff,
    secondBytes.length & 0xff,
  ]);

  const combined = new Uint8Array(
    header.length + firstBytes.length + separator.length + secondBytes.length
  );
  combined.set(header, 0);
  combined.set(firstBytes, header.length);
  combined.set(separator, header.length + firstBytes.length);
  combined.set(secondBytes, header.length + firstBytes.length + separator.length);

  // Hash combined public keys with SHA-512 (64 bytes = 512 bits)
  const sha512Buffer = await crypto.subtle.digest('SHA-512', combined);
  const digestBytes = new Uint8Array(sha512Buffer);

  // Convert 12 chunks of 5 bytes (60 bytes total) into 12 blocks of 5 numeric digits (Signal Protocol style)
  /** @type {string[]} */
  const blocks = [];
  for (let i = 0; i < SAFETY_NUMBER_BLOCK_COUNT; i++) {
    const offset = i * 5;
    const chunkValue =
      (BigInt(digestBytes[offset]) << 32n) |
      (BigInt(digestBytes[offset + 1]) << 24n) |
      (BigInt(digestBytes[offset + 2]) << 16n) |
      (BigInt(digestBytes[offset + 3]) << 8n) |
      BigInt(digestBytes[offset + 4]);
    const fiveDigits = Number(chunkValue % 100000n)
      .toString()
      .padStart(SAFETY_NUMBER_BLOCK_SIZE, '0');
    blocks.push(fiveDigits);
  }

  const rawDigits = blocks.join('');
  const formatted = blocks.join(' ');
  const combinedFingerprint = toBase64Url(digestBytes.slice(0, 32).buffer);
  const qrPayload = buildSafetyNumberQrPayload({
    rawDigits,
    combinedFingerprint,
    userAId,
    userBId,
  });

  return {
    rawDigits,
    blocks,
    formatted,
    combinedFingerprint,
    fingerprintA,
    fingerprintB,
    qrPayload,
  };
}

// ── Pure Local ISO/IEC 18004 QR Code Generator (Byte Mode, ECC Level L) ────────

/**
 * Version parameters for QR Code Versions 1..10 at Error Correction Level L:
 * [version, size, totalDataCodewords, ecCodewordsPerBlock, numBlocks, alignmentCenters]
 * @type {Array<[number, number, number, number, number, number[]]>}
 */
const QR_VERSION_TABLE_L = [
  [1, 21, 19, 7, 1, []],
  [2, 25, 34, 10, 1, [6, 18]],
  [3, 29, 55, 15, 1, [6, 22]],
  [4, 33, 80, 20, 1, [6, 26]],
  [5, 37, 108, 26, 1, [6, 30]],
  [6, 41, 136, 18, 2, [6, 34]],
  [7, 45, 156, 20, 2, [6, 22, 38]],
  [8, 49, 194, 24, 2, [6, 24, 42]],
  [9, 53, 232, 30, 2, [6, 26, 46]],
  [10, 57, 274, 18, 4, [6, 28, 50]],
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * Compute Reed-Solomon error correction codewords for a data block.
 * @param {Uint8Array} data
 * @param {number} ecLen
 * @returns {Uint8Array}
 */
function reedSolomonEncode(data, ecLen) {
  let gen = new Uint8Array([1]);
  for (let i = 0; i < ecLen; i++) {
    const next = new Uint8Array(gen.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], root);
    }
    gen = next;
  }

  const remainder = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        remainder[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return remainder;
}

/**
 * Generate a 2D boolean matrix representing an ISO/IEC 18004 QR Code for `payload`.
 *
 * @param {string} payload
 * @returns {boolean[][]}
 */
export function generateQrCodeMatrix(payload) {
  if (!payload || typeof payload !== 'string') {
    throw new Error('QR payload must be a non-empty string.');
  }

  const utf8 = new TextEncoder().encode(payload);

  // Select smallest version that fits utf8 bytes in Byte Mode (4-bit mode + 8/16-bit length + data)
  const spec = QR_VERSION_TABLE_L.find(([ver, , totalData]) => {
    const headerBits = ver <= 9 ? 12 : 20;
    return utf8.length * 8 + headerBits <= totalData * 8;
  });

  if (!spec) {
    throw new Error('QR payload exceeds maximum supported local QR capacity.');
  }

  const [version, size, totalDataCodewords, ecLen, numBlocks, alignCenters] = spec;

  // Build bit stream: Byte Mode (0100), character count (8 bits for v1..9, 16 bits for v10)
  /** @type {number[]} */
  const bits = [0, 1, 0, 0];
  const countBits = version <= 9 ? 8 : 16;
  for (let i = countBits - 1; i >= 0; i--) {
    bits.push((utf8.length >> i) & 1);
  }
  for (let i = 0; i < utf8.length; i++) {
    for (let b = 7; b >= 0; b--) {
      bits.push((utf8[i] >> b) & 1);
    }
  }

  const maxDataBits = totalDataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < maxDataBits; i++) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const dataBytes = new Uint8Array(totalDataCodewords);
  const filledBytes = bits.length / 8;
  for (let i = 0; i < filledBytes; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    dataBytes[i] = byte;
  }
  const padBytes = [0xec, 0x11];
  for (let i = filledBytes; i < totalDataCodewords; i++) {
    dataBytes[i] = padBytes[(i - filledBytes) % 2];
  }

  // Split into blocks and compute Reed-Solomon ECC
  const blockSize = Math.floor(totalDataCodewords / numBlocks);
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = b === numBlocks - 1 ? totalDataCodewords - offset : blockSize;
    const block = dataBytes.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomonEncode(block, ecLen));
  }

  // Interleave data and EC codewords
  /** @type {number[]} */
  const finalCodewords = [];
  const maxBlockLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxBlockLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < dataBlocks[b].length) finalCodewords.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < ecLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      finalCodewords.push(ecBlocks[b][i]);
    }
  }

  // Initialize module matrix and reservation mask
  /** @type {boolean[][]} */
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  /** @type {boolean[][]} */
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (/** @type {number} */ r, /** @type {number} */ c, /** @type {boolean} */ dark) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      modules[r][c] = dark;
      reserved[r][c] = true;
    }
  };

  // Finder patterns + separators
  const placeFinder = (/** @type {number} */ top, /** @type {number} */ left) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onBorder || inInner));
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  for (const rCenter of alignCenters) {
    for (const cCenter of alignCenters) {
      if (
        (rCenter === 6 && cCenter === 6) ||
        (rCenter === 6 && cCenter === size - 7) ||
        (rCenter === size - 7 && cCenter === 6)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(rCenter + dr, cCenter + dc, dark);
        }
      }
    }
  }

  // Reserve format info areas & dark module
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  setFunctionModule(size - 8, 8, true);

  // Reserve version info areas for version >= 7
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    }
    const verBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((verBits >> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(b, a, bit);
      setFunctionModule(a, b, bit);
    }
  }

  // Place data bits in upward/downward 2-column zig-zag
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip vertical timing line
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            const cw = finalCodewords[bitIdx >> 3];
            dark = ((cw >> (7 - (bitIdx & 7))) & 1) !== 0;
            bitIdx++;
          }
          // Apply Mask Pattern 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) {
            dark = !dark;
          }
          modules[r][c] = dark;
        }
      }
    }
    upward = !upward;
  }

  // Write Format Information for ECC Level L (01) + Mask 0 (000) -> 0x77c4
  const formatBits = 0x77c4;
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, ((formatBits >> i) & 1) !== 0);
  setFunctionModule(8, 7, ((formatBits >> 6) & 1) !== 0);
  setFunctionModule(8, 8, ((formatBits >> 7) & 1) !== 0);
  setFunctionModule(7, 8, ((formatBits >> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, ((formatBits >> i) & 1) !== 0);

  for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, ((formatBits >> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, ((formatBits >> i) & 1) !== 0);

  return modules;
}

/**
 * Render a local, standards-compliant SVG QR Code string for the given payload.
 *
 * @param {string} payload
 * @param {{ size?: number, margin?: number, darkColor?: string, lightColor?: string, title?: string }} [options]
 * @returns {string}
 */
export function generateQrCodeSvg(
  payload,
  {
    size = 220,
    margin = 4,
    darkColor = '#0f172a',
    lightColor = '#ffffff',
    title = 'Kode QR Nomor Keamanan E2EE',
  } = {}
) {
  const matrix = generateQrCodeMatrix(payload);
  const moduleCount = matrix.length;
  const viewBoxSize = moduleCount + margin * 2;

  /** @type {string[]} */
  const pathSegments = [];
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (matrix[r][c]) {
        pathSegments.push(`M${c + margin},${r + margin}h1v1h-1z`);
      }
    }
  }

  const escapedTitle = String(title)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${size}" height="${size}" role="img" aria-label="${escapedTitle}" shape-rendering="crispEdges">`,
    `<title>${escapedTitle}</title>`,
    `<rect width="100%" height="100%" fill="${lightColor}" rx="1.5" />`,
    `<path d="${pathSegments.join('')}" fill="${darkColor}" />`,
    `</svg>`,
  ].join('');
}

