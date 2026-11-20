import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import env from '../config/env.js';

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MFA_ENCRYPTION_KEY = createHash('sha256')
  .update('GetTalk MFA encryption v1:')
  .update(env.mfaEncryptionKey)
  .digest();

export function generateTotpSecret() {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let encoded = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) encoded += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return encoded;
}

function decodeBase32(value) {
  let bits = 0;
  let buffer = 0;
  const bytes = [];

  for (const character of value.toUpperCase().replace(/=+$/, '')) {
    const digit = BASE32_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error('Invalid Base32 TOTP secret');
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotp(secret, time = Date.now()) {
  const counter = Math.floor(time / 1000 / TOTP_PERIOD_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
}

export function findTotpStep(secret, code, time = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const supplied = Buffer.from(code);
  const currentStep = Math.floor(time / 1000 / TOTP_PERIOD_SECONDS);

  for (const offset of [-1, 0, 1]) {
    const step = currentStep + offset;
    const candidate = Buffer.from(
      generateTotp(secret, step * TOTP_PERIOD_SECONDS * 1000)
    );
    if (timingSafeEqual(supplied, candidate)) return step;
  }

  return null;
}

export function verifyTotp(secret, code, time = Date.now()) {
  return findTotpStep(secret, code, time) !== null;
}

export function encryptMfaSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', MFA_ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptMfaSecret(encrypted) {
  const [encodedIv, encodedTag, encodedCiphertext] = encrypted.split('.');
  if (!encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error('Stored MFA secret has an invalid format');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    MFA_ENCRYPTION_KEY,
    Buffer.from(encodedIv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(12).toString('hex').toUpperCase();
    return raw.match(/.{1,4}/g).join('-');
  });
}

export function hashRecoveryCode(code) {
  return createHash('sha256')
    .update(code.replaceAll('-', '').toUpperCase())
    .digest('hex');
}

export function createTotpUri(secret, email) {
  const label = encodeURIComponent(`GetTalk:${email}`);
  const parameters = new URLSearchParams({
    secret,
    issuer: 'GetTalk',
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}
