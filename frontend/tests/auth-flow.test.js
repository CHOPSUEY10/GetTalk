process.env.VITE_APP_ENV = process.env.VITE_APP_ENV || 'development';
process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
process.env.VITE_SOCKET_URL = process.env.VITE_SOCKET_URL || 'http://localhost:3000';

import 'fake-indexeddb/auto';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { get } from 'svelte/store';

let register;
let verifyRegistrationOtp;
let resendRegistrationOtp;
let forgotPassword;
let verifyResetOtp;
let resetPassword;
let authStore;
let validateRegistrationInput;
let validateRegistrationOtpInput;

const __dirname = dirname(fileURLToPath(import.meta.url));

before(async () => {
  ({
    register,
    verifyRegistrationOtp,
    resendRegistrationOtp,
    forgotPassword,
    verifyResetOtp,
    resetPassword,
  } = await import('../src/services/api/auth.api.js'));
  ({ authStore } = await import('../src/stores/auth.store.js'));
  ({ validateRegistrationInput, validateRegistrationOtpInput } = await import(
    '../src/lib/validators.js'
  ));
});

describe('Frontend Password Reset Flow (6-Digit OTP)', () => {
  let originalFetch;
  let fetchCalls = [];

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('auth.api.forgotPassword sends POST to /api/auth/password/forgot', async () => {
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(
        JSON.stringify({
          message: 'Jika email terdaftar, tautan pengaturan ulang kata sandi telah dikirimkan.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const res = await forgotPassword({ email: 'user@example.com' });
    assert.equal(
      res.message,
      'Jika email terdaftar, tautan pengaturan ulang kata sandi telah dikirimkan.'
    );
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.endsWith('/api/auth/password/forgot'));
    assert.equal(fetchCalls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body), { email: 'user@example.com' });
  });

  test('auth.api.verifyResetOtp sends POST to /api/auth/password/verify with 6-digit OTP', async () => {
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(
        JSON.stringify({
          valid: true,
          message: 'Kode OTP valid.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const payload = {
      email: 'user@example.com',
      token: '482910',
    };

    const res = await verifyResetOtp(payload);
    assert.equal(res.valid, true);
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.endsWith('/api/auth/password/verify'));
    assert.equal(fetchCalls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body), payload);
  });

  test('authStore.verifyResetOtp rejects INVALID_RESET_TOKEN at the verify step before reset', async () => {
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_RESET_TOKEN',
            message: 'Invalid or expired reset token',
          },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    await assert.rejects(
      async () => {
        await authStore.verifyResetOtp({
          email: 'requiemstand90@gmail.com',
          token: '123456',
        });
      },
      (err) => {
        assert.equal(err.code, 'INVALID_RESET_TOKEN');
        return true;
      }
    );

    const state = get(authStore);
    assert.equal(state.loading, false);
    assert.equal(state.errorCode, 'INVALID_RESET_TOKEN');
    assert.equal(
      state.error,
      'Kode OTP pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.'
    );
  });

  test('auth.api.resetPassword sends POST to /api/auth/password/reset with 6-digit OTP', async () => {
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(
        JSON.stringify({
          message: 'Kata sandi berhasil diubah. Silakan login kembali.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const payload = {
      email: 'user@example.com',
      token: '482910',
      newPassword: 'NewStrongPassword123!',
    };

    const res = await resetPassword(payload);
    assert.equal(res.message, 'Kata sandi berhasil diubah. Silakan login kembali.');
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.endsWith('/api/auth/password/reset'));
    assert.equal(fetchCalls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body), payload);
  });

  test('authStore.forgotPassword executes without unmounting router via global loading', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          message: 'Jika email terdaftar, tautan pengaturan ulang kata sandi telah dikirimkan.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const res = await authStore.forgotPassword({ email: 'test@example.com' });
    assert.ok(res.message);
    const state = get(authStore);
    assert.equal(state.loading, false);
    assert.equal(state.error, null);
  });

  test('authStore.resetPassword normalizes password fields and records API error in store', async () => {
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_RESET_TOKEN',
            message: 'Kode OTP pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.',
          },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    await assert.rejects(
      async () => {
        await authStore.resetPassword({
          email: 'test@example.com',
          token: '123456',
          password: 'Password123!',
        });
      },
      (err) => {
        assert.equal(
          err.message,
          'Kode OTP pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.'
        );
        return true;
      }
    );

    const sentBody = JSON.parse(fetchCalls[0].options.body);
    assert.equal(sentBody.token, '123456');
    assert.equal(sentBody.newPassword, 'Password123!');

    const state = get(authStore);
    assert.equal(state.loading, false);
    assert.equal(
      state.error,
      'Kode OTP pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.'
    );
  });

  test('authStore.initialize does not set PAGE_ERROR_CODES.NETWORK_ERROR on initial load without session token', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };

    await authStore.initialize();

    const state = get(authStore);
    assert.equal(state.authenticated, false);
    assert.equal(state.loading, false);
    assert.equal(state.error, null);
    assert.equal(state.errorCode, null);
  });
});

describe('Frontend Registration -> Email OTP Verification -> Login Flow', () => {
  let originalFetch;
  let fetchCalls = [];

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    authStore.setUnauthenticated();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('auth.api registration verification helpers target the expected endpoints', async () => {
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await register({ username: 'alice', email: 'alice@example.com', password: 'Password123!' });
    await verifyRegistrationOtp({ email: 'alice@example.com', otp: '123456' });
    await resendRegistrationOtp({ email: 'alice@example.com' });

    assert.equal(fetchCalls.length, 3);
    assert.ok(fetchCalls[0].url.endsWith('/api/auth/register'));
    assert.ok(fetchCalls[1].url.endsWith('/api/auth/register/verify'));
    assert.ok(fetchCalls[2].url.endsWith('/api/auth/register/resend'));
    assert.deepEqual(JSON.parse(fetchCalls[1].options.body), {
      email: 'alice@example.com',
      otp: '123456',
    });
  });

  test('authStore.register keeps user unauthenticated while awaiting email OTP verification', async () => {
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(
        JSON.stringify({
          user: {
            id: 'usr-1',
            username: 'alice',
            email: 'alice@example.com',
            emailVerified: false,
          },
          verificationRequired: true,
          expiresInSeconds: 900,
          message: 'Pendaftaran berhasil. Kode verifikasi OTP 6 digit telah dikirim ke email Anda.',
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const res = await authStore.register({
      username: 'alice',
      email: 'alice@example.com',
      password: 'Password123!',
    });

    assert.equal(res.verificationRequired, true);
    assert.equal(res.user.emailVerified, false);

    const state = get(authStore);
    assert.equal(state.authenticated, false);
    assert.equal(state.loading, false);
    assert.equal(state.user, null);
    assert.equal(state.error, null);
  });

  test('authStore.verifyRegistrationOtp succeeds without auto-logging in and maps INVALID_OTP_TOKEN / OTP_TOKEN_EXPIRED', async () => {
    // 1. Valid OTP succeeds, keeps authenticated=false (user proceeds to /login)
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(
        JSON.stringify({
          verified: true,
          user: { id: 'usr-1', username: 'alice', email: 'alice@example.com', emailVerified: true },
          message: 'Email berhasil diverifikasi. Silakan masuk ke akun Anda.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const okRes = await authStore.verifyRegistrationOtp({
      email: 'alice@example.com',
      otp: '482910',
    });
    assert.equal(okRes.verified, true);
    assert.equal(get(authStore).authenticated, false);
    assert.equal(get(authStore).error, null);

    // 2. Invalid OTP sets INVALID_OTP_TOKEN error state
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'INVALID_OTP_TOKEN', message: 'Invalid verification code' },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );

    await assert.rejects(
      () => authStore.verifyRegistrationOtp({ email: 'alice@example.com', otp: '000000' }),
      (err) => err.code === 'INVALID_OTP_TOKEN'
    );
    assert.equal(get(authStore).errorCode, 'INVALID_OTP_TOKEN');
    assert.match(get(authStore).error, /tidak valid/i);

    // 3. Expired OTP sets OTP_TOKEN_EXPIRED error state
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'OTP_TOKEN_EXPIRED', message: 'Verification OTP has expired' },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );

    await assert.rejects(
      () => authStore.verifyRegistrationOtp({ email: 'alice@example.com', otp: '482910' }),
      (err) => err.code === 'OTP_TOKEN_EXPIRED'
    );
    assert.equal(get(authStore).errorCode, 'OTP_TOKEN_EXPIRED');
    assert.match(get(authStore).error, /kedaluwarsa/i);
  });

  test('authStore.resendRegistrationOtp sends email and records error on 429 rate limit', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          message: 'Jika email terdaftar dan belum diverifikasi, kode OTP verifikasi baru telah dikirimkan.',
          expiresInSeconds: 900,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const ok = await authStore.resendRegistrationOtp({ email: 'alice@example.com' });
    assert.equal(ok.expiresInSeconds, 900);
    assert.equal(get(authStore).error, null);

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );

    await assert.rejects(
      () => authStore.resendRegistrationOtp({ email: 'alice@example.com' }),
      (err) => err.code === 'TOO_MANY_REQUESTS'
    );
    assert.equal(get(authStore).errorCode, 'TOO_MANY_REQUESTS');
  });

  test('authStore.login records EMAIL_NOT_VERIFIED when logging in before email verification', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Email address has not been verified',
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );

    await assert.rejects(
      () => authStore.login({ email: 'alice@example.com', password: 'Password123!' }),
      (err) => err.code === 'EMAIL_NOT_VERIFIED' && err.status === 403
    );

    const state = get(authStore);
    assert.equal(state.authenticated, false);
    assert.equal(state.errorCode, 'EMAIL_NOT_VERIFIED');
    assert.match(state.error, /belum diverifikasi/i);
  });

  test('validators validate registration and 6-digit email OTP inputs', () => {
    assert.equal(
      validateRegistrationInput({
        username: 'alice_01',
        email: 'alice@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      }).valid,
      true
    );
    assert.equal(
      validateRegistrationInput({
        username: 'a',
        email: 'alice@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      }).code,
      'INVALID_USERNAME_FORMAT'
    );
    assert.equal(
      validateRegistrationInput({
        username: 'alice_01',
        email: 'bad-email',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      }).code,
      'INVALID_EMAIL_FORMAT'
    );
    assert.equal(
      validateRegistrationOtpInput({ email: 'alice@example.com', otp: '123456' }).valid,
      true
    );
    assert.equal(
      validateRegistrationOtpInput({ email: 'alice@example.com', otp: '12ab' }).code,
      'INVALID_OTP_CODE'
    );
  });

  test('Register.svelte, VerifyEmail.svelte, and Login.svelte compile cleanly without syntax errors', () => {
    for (const filename of ['Register.svelte', 'VerifyEmail.svelte', 'Login.svelte']) {
      const source = readFileSync(resolve(__dirname, '../src/pages', filename), 'utf8');
      const compiled = compile(source, { filename });
      assert.ok(compiled.js.code.length > 0, `${filename} should compile cleanly`);
    }
  });
});
