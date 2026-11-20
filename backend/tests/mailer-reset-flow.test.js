/**
 * Unit tests for password reset OTP flow, env SMTP normalization, and mailer safeguards.
 * Runs fully offline without requiring PostgreSQL or Redis.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sendPasswordResetEmail,
  sendEmailChangeOtp,
  sendRegistrationVerificationOtp,
  getLastSentEmail,
  clearLastSentEmail,
  maskEmail,
} from '../src/services/mailer.service.js';
import { generateOtpToken } from '../src/services/password-reset.service.js';
import {
  validateForgotPassword,
  validateVerifyResetOtp,
  validateResetPassword,
  validateVerifyRegistrationOtp,
  validateResendRegistrationOtp,
} from '../src/validators/auth.validator.js';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Env SMTP Configuration & Normalization', () => {
  test('populates SMTP credentials even when process.env has empty-string placeholders and normalizes SMTP_FROM', () => {
    const script = `
      import env from './src/config/env.js';
      console.log(JSON.stringify({
        smtpHost: env.smtpHost,
        smtpPort: env.smtpPort,
        smtpUser: env.smtpUser,
        smtpPassLen: env.smtpPass.length,
        smtpFrom: env.smtpFrom,
      }));
    `;

    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: backendRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: '3000',
        CORS_ORIGIN: 'http://localhost:5173',
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/gettalk',
        SESSION_SECRET: 'test-session-secret',
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_USER: 'sender@gmail.com',
        SMTP_PASS: 'abcd efgh ijkl mnop',
        SMTP_FROM: '"GetTalk Security <no-reply@gettalk.app>"',
      },
      encoding: 'utf8',
    });

    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.smtpHost, 'smtp.gmail.com');
    assert.equal(parsed.smtpPort, 587);
    assert.equal(parsed.smtpUser, 'sender@gmail.com');
    assert.equal(parsed.smtpPassLen, 16, 'App password spaces must be stripped');
    assert.equal(
      parsed.smtpFrom,
      'GetTalk Security <sender@gmail.com>',
      'Placeholder @gettalk.app domain must be aligned to authenticated Gmail SMTP_USER'
    );
  });

  test('fails loudly with 500 INTERNAL_ERROR outside test runner when SMTP credentials are missing (no silent Ethereal trap)', () => {
    const script = `
      import { sendPasswordResetEmail } from './src/services/mailer.service.js';
      try {
        await sendPasswordResetEmail({ email: 'user@example.com', token: '123456' });
        console.log(JSON.stringify({ ok: true }));
      } catch (err) {
        console.log(JSON.stringify({
          ok: false,
          statusCode: err.statusCode,
          code: err.code,
          message: err.message,
        }));
      }
    `;

    // Strip NODE_TEST_CONTEXT and supply an isolated env where SMTP_HOST is blank
    // while pointing to a fake explicit non-matching SMTP_USER/PASS override:
    const isolatedEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: '3000',
      CORS_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/gettalk',
      SESSION_SECRET: 'test-session-secret',
      // Force missing SMTP host via quotes-only value so fallback loader does not overwrite
      SMTP_HOST: '""',
      SMTP_USER: '""',
      SMTP_PASS: '""',
    };

    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: backendRoot,
      env: isolatedEnv,
      encoding: 'utf8',
    });

    const lines = stdout.trim().split(/\r?\n/);
    const parsed = JSON.parse(lines[lines.length - 1]);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.statusCode, 500);
    assert.equal(parsed.code, 'INTERNAL_ERROR');
  });
});

describe('Mailer Service & OTP Validation', () => {
  test('captures password reset OTP in test sink without making external SMTP calls', async () => {
    clearLastSentEmail();
    const res = await sendPasswordResetEmail({
      email: '  user@example.com  ',
      token: ' 482910 ',
    });
    assert.deepEqual(res, { success: true });
    const sent = getLastSentEmail();
    assert.ok(sent);
    assert.equal(sent.to, 'user@example.com');
    assert.equal(sent.token, '482910');
  });

  test('captures email change OTP in test sink', async () => {
    clearLastSentEmail();
    const res = await sendEmailChangeOtp({
      email: 'new@example.com',
      token: '654321',
    });
    assert.deepEqual(res, { success: true });
    const sent = getLastSentEmail();
    assert.ok(sent);
    assert.equal(sent.to, 'new@example.com');
    assert.equal(sent.token, '654321');
    assert.equal(sent.purpose, 'email_change');
  });

  test('captures registration verification OTP in test sink', async () => {
    clearLastSentEmail();
    const res = await sendRegistrationVerificationOtp({
      email: 'alice@example.com',
      username: 'alice',
      token: '739104',
    });
    assert.deepEqual(res, { success: true });
    const sent = getLastSentEmail();
    assert.ok(sent);
    assert.equal(sent.to, 'alice@example.com');
    assert.equal(sent.token, '739104');
    assert.equal(sent.purpose, 'registration_verification');
    assert.match(sent.verifyUrl, /\/#\/register\/verify\?email=alice%40example\.com$/);
  });

  test('rejects missing email or OTP token with 400 VALIDATION_ERROR', async () => {
    await assert.rejects(
      () => sendPasswordResetEmail({ email: '', token: '123456' }),
      (err) => err.statusCode === 400 && err.code === 'VALIDATION_ERROR'
    );
    await assert.rejects(
      () => sendPasswordResetEmail({ email: 'user@example.com', token: '' }),
      (err) => err.statusCode === 400 && err.code === 'VALIDATION_ERROR'
    );
  });

  test('maskEmail masks email addresses safely for logging', () => {
    assert.equal(maskEmail('fadliaidin16@gmail.com'), 'f***6@gmail.com');
    assert.equal(maskEmail('ab@example.com'), 'a***@example.com');
    assert.equal(maskEmail('invalid'), '***');
  });

  test('generateOtpToken produces valid 6-digit numeric OTP strings', () => {
    for (let i = 0; i < 20; i += 1) {
      const otp = generateOtpToken();
      assert.match(otp, /^\d{6}$/);
    }
  });

  test('validators enforce email, 6-digit OTP, and password rules', () => {
    assert.equal(validateForgotPassword({ email: 'user@example.com' }).valid, true);
    assert.equal(validateForgotPassword({ email: 'not-an-email' }).valid, false);

    assert.equal(validateVerifyResetOtp({ email: 'user@example.com', token: '123456' }).valid, true);
    assert.equal(validateVerifyResetOtp({ email: 'user@example.com', otp: '123456' }).valid, true);
    assert.equal(validateVerifyResetOtp({ email: 'user@example.com', token: '12345' }).valid, false);
    assert.equal(validateVerifyResetOtp({ email: 'user@example.com', token: 'abcdef' }).valid, false);

    assert.equal(
      validateResetPassword({ email: 'user@example.com', token: '123456', newPassword: 'Password123!' }).valid,
      true
    );
    assert.equal(
      validateResetPassword({ email: 'user@example.com', token: '123456', newPassword: 'short' }).valid,
      false
    );

    assert.equal(
      validateVerifyRegistrationOtp({ email: 'user@example.com', otp: '123456' }).valid,
      true
    );
    assert.equal(
      validateVerifyRegistrationOtp({ email: 'user@example.com', token: '123456' }).valid,
      true
    );
    assert.equal(
      validateVerifyRegistrationOtp({ email: 'user@example.com', otp: '12345' }).valid,
      false
    );
    assert.equal(
      validateResendRegistrationOtp({ email: 'user@example.com' }).valid,
      true
    );
    assert.equal(
      validateResendRegistrationOtp({ email: 'invalid' }).valid,
      false
    );
  });
});
