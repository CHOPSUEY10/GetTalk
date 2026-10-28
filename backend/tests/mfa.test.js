import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTotpUri,
  decryptMfaSecret,
  encryptMfaSecret,
  findTotpStep,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from '../src/utils/mfa.js';

test('TOTP matches the RFC 6238 SHA-1 test vector', () => {
  const secret = 'GEZDGNBV GY3TQOJQ GEZDGNBV GY3TQOJQ'.replaceAll(' ', '');

  assert.equal(generateTotp(secret, 59_000), '287082');
  assert.equal(verifyTotp(secret, '287082', 59_000), true);
  assert.equal(findTotpStep(secret, '287082', 59_000), 1);
  assert.equal(verifyTotp(secret, '000000', 59_000), false);
});

test('TOTP accepts adjacent time steps for clock drift', () => {
  const secret = generateTotpSecret();
  const currentTime = 1_800_000_000_000;
  const priorCode = generateTotp(secret, currentTime - 30_000);

  assert.equal(verifyTotp(secret, priorCode, currentTime), true);
  assert.equal(verifyTotp(secret, 'not-a-code', currentTime), false);
});

test('TOTP secrets are encrypted at rest and authenticator URIs are valid', () => {
  const secret = generateTotpSecret();
  const encrypted = encryptMfaSecret(secret);

  assert.notEqual(encrypted, secret);
  assert.equal(decryptMfaSecret(encrypted), secret);
  assert.match(
    createTotpUri(secret, 'user@example.com'),
    /^otpauth:\/\/totp\/GetTalk%3Auser%40example\.com\?/
  );
});

test('recovery codes are unique and normalized before hashing', () => {
  const codes = generateRecoveryCodes();

  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[0].replaceAll('-', '')));
});
