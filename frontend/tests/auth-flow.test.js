process.env.VITE_APP_ENV = process.env.VITE_APP_ENV || 'development';
process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
process.env.VITE_SOCKET_URL = process.env.VITE_SOCKET_URL || 'http://localhost:3000';

import 'fake-indexeddb/auto';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';

let forgotPassword;
let resetPassword;
let authStore;

before(async () => {
  ({ forgotPassword, resetPassword } = await import('../src/services/api/auth.api.js'));
  ({ authStore } = await import('../src/stores/auth.store.js'));
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
});
