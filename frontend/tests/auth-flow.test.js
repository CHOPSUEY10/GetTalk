process.env.VITE_APP_ENV = process.env.VITE_APP_ENV || 'development';
process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
process.env.VITE_SOCKET_URL = process.env.VITE_SOCKET_URL || 'http://localhost:3000';

import 'fake-indexeddb/auto';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { forgotPassword, resetPassword } from '../src/services/api/auth.api.js';
import { authStore } from '../src/stores/auth.store.js';

describe('Frontend Password Reset Flow', () => {
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

  test('auth.api.resetPassword sends POST to /api/auth/password/reset', async () => {
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(
        JSON.stringify({
          message: 'Kata sandi berhasil diatur ulang. Silakan masuk kembali.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const payload = {
      email: 'user@example.com',
      token: 'a'.repeat(64),
      password: 'NewStrongPassword123!',
    };

    const res = await resetPassword(payload);
    assert.equal(res.message, 'Kata sandi berhasil diatur ulang. Silakan masuk kembali.');
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.endsWith('/api/auth/password/reset'));
    assert.equal(fetchCalls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body), payload);
  });

  test('authStore.forgotPassword executes and manages loading state', async () => {
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

  test('authStore.resetPassword catches error and records error in store', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_TOKEN',
            message: 'Token pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.',
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
          token: 'invalid',
          password: 'Password123!',
        });
      },
      (err) => {
        assert.equal(
          err.message,
          'Token pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.'
        );
        return true;
      }
    );

    const state = get(authStore);
    assert.equal(state.loading, false);
    assert.equal(
      state.error,
      'Token pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.'
    );
  });
});
