process.env.VITE_APP_ENV = process.env.VITE_APP_ENV || 'development';
process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
process.env.VITE_SOCKET_URL = process.env.VITE_SOCKET_URL || 'http://localhost:3000';

import 'fake-indexeddb/auto';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';

import {
  API_ERROR_CODES,
  API_ERROR_CATEGORIES,
  ApiError,
  normalizeApiError,
  logApiError,
  handleApiError,
  sanitizeUrl,
  sanitizeApiMetadata,
} from '../src/errors/apierror.js';
import {
  ENCRYPTION_ERROR_CODES,
  EncryptionError,
  normalizeEncryptionError,
  logEncryptionError,
  handleEncryptionError,
  sanitizeEncryptionMetadata,
} from '../src/errors/encryptionerror.js';
import {
  PAGE_ERROR_CODES,
  DEFAULT_USER_MESSAGES,
  resolvePageError,
  getPageErrorMessage,
  createValidationError,
} from '../src/errors/pageerror.js';
import { generateKeyPair, exportPublicKeyBase64 } from '../src/services/crypto/ecdh.js';
import {
  establishConversationKey,
  encryptMessage,
  decryptMessage,
  clearCryptoState,
} from '../src/services/crypto/message-crypto.js';
import { toBase64Url } from '../src/services/crypto/aes-gcm.js';

let api;
let authStore;
let friendsStore;
let conversationsStore;
let messagesStore;

before(async () => {
  ({ api } = await import('../src/services/api/client.js'));
  ({ authStore } = await import('../src/stores/auth.store.js'));
  ({ friendsStore } = await import('../src/stores/friends.store.js'));
  ({ conversationsStore } = await import('../src/stores/conversations.store.js'));
  ({ messagesStore } = await import('../src/stores/messages.store.js'));
});

describe('Centralized Error Handling — Unit & Security Tests', () => {
  let originalConsoleError;
  let originalConsoleWarn;
  let originalFetch;
  /** @type {any[][]} */
  let loggedErrors = [];
  /** @type {any[][]} */
  let loggedWarnings = [];

  beforeEach(async () => {
    loggedErrors = [];
    loggedWarnings = [];
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    originalFetch = globalThis.fetch;

    console.error = (...args) => {
      loggedErrors.push(args);
    };
    console.warn = (...args) => {
      loggedWarnings.push(args);
    };

    await clearCryptoState();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    globalThis.fetch = originalFetch;
  });

  // ── 1. API Error Normalization & HTTP Statuses ─────────────────────────────

  describe('1. apierror — HTTP Statuses, Network, Timeout & Invalid Response', () => {
    test('normalizes 401, 403, 429, and 500 HTTP responses into consistent codes and categories', () => {
      const err401 = normalizeApiError(null, {
        status: 401,
        endpoint: '/api/conversations',
        method: 'GET',
      });
      assert.equal(err401.code, API_ERROR_CODES.UNAUTHORIZED);
      assert.equal(err401.category, API_ERROR_CATEGORIES.UNAUTHORIZED);
      assert.equal(err401.source, 'api');
      assert.equal(err401.status, 401);

      const err403 = normalizeApiError(null, {
        status: 403,
        endpoint: '/api/messages/msg-1',
        method: 'DELETE',
      });
      assert.equal(err403.code, API_ERROR_CODES.FORBIDDEN);
      assert.equal(err403.category, API_ERROR_CATEGORIES.FORBIDDEN);
      assert.equal(err403.status, 403);

      const err429 = normalizeApiError(null, {
        status: 429,
        endpoint: '/api/auth/login',
        method: 'POST',
      });
      assert.equal(err429.code, API_ERROR_CODES.TOO_MANY_REQUESTS);
      assert.equal(err429.category, API_ERROR_CATEGORIES.TOO_MANY_REQUESTS);
      assert.equal(err429.status, 429);

      const err500 = normalizeApiError(null, {
        status: 500,
        endpoint: '/api/messages',
        method: 'POST',
        data: { error: { code: 'INTERNAL_ERROR', message: 'Unexpected database crash' } },
      });
      assert.equal(err500.code, API_ERROR_CODES.SERVER_ERROR);
      assert.equal(err500.category, API_ERROR_CATEGORIES.SERVER_ERROR);
      assert.equal(err500.status, 500);
    });

    test('normalizes network disconnection and request timeout errors', () => {
      const networkErr = normalizeApiError(new TypeError('Failed to fetch'), {
        endpoint: 'http://localhost:3000/api/conversations?token=secret123',
        method: 'GET',
      });
      assert.equal(networkErr.code, API_ERROR_CODES.NETWORK_ERROR);
      assert.equal(networkErr.category, API_ERROR_CATEGORIES.NETWORK_ERROR);
      assert.equal(networkErr.endpoint, '/api/conversations');

      const abortException = new DOMException('The operation was aborted.', 'AbortError');
      const timeoutErr = normalizeApiError(abortException, {
        endpoint: '/api/messages',
        method: 'POST',
      });
      assert.equal(timeoutErr.code, API_ERROR_CODES.REQUEST_TIMEOUT);
      assert.equal(timeoutErr.category, API_ERROR_CATEGORIES.REQUEST_TIMEOUT);
      assert.equal(timeoutErr.status, 408);
    });

    test('normalizes invalid/malformed JSON API response as INVALID_RESPONSE', async () => {
      globalThis.fetch = async () =>
        new Response('<<<not valid json>>>', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      await assert.rejects(
        () => api.get('/api/conversations'),
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.code, API_ERROR_CODES.INVALID_RESPONSE);
          assert.equal(err.category, API_ERROR_CATEGORIES.INVALID_RESPONSE);
          return true;
        }
      );
    });

    test('prevents duplicate error logging when the same ApiError passes through multiple layers', () => {
      const rawError = new TypeError('Failed to fetch');
      const firstPass = handleApiError(rawError, {
        endpoint: '/api/friends',
        method: 'GET',
      });
      assert.equal(firstPass.logged, true);
      assert.equal(loggedErrors.length, 1);

      // Second pass in store or page layer must not produce a second log entry
      const secondPass = handleApiError(firstPass, {
        endpoint: '/api/friends',
        method: 'GET',
      });
      assert.equal(secondPass, firstPass);
      assert.equal(loggedErrors.length, 1);
    });
  });

  // ── 2. Encryption Error Normalization & E2EE Safety ────────────────────────

  describe('2. encryptionerror — Crypto Operations & Key Management', () => {
    test('normalizes encryption, decryption, key exchange, key unavailable, and invalid ciphertext errors', () => {
      const encErr = normalizeEncryptionError(new Error('WebCrypto failure'), {
        code: ENCRYPTION_ERROR_CODES.ENCRYPTION_FAILED,
        operation: 'encrypt',
      });
      assert.ok(encErr instanceof EncryptionError);
      assert.equal(encErr.code, ENCRYPTION_ERROR_CODES.ENCRYPTION_FAILED);
      assert.equal(encErr.source, 'encryption');

      const decErr = normalizeEncryptionError(new Error('OperationError'), {
        code: ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED,
        operation: 'decrypt',
      });
      assert.equal(decErr.code, ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED);

      const keyExErr = normalizeEncryptionError(new Error('Invalid peer point'), {
        code: ENCRYPTION_ERROR_CODES.KEY_EXCHANGE_FAILED,
        operation: 'key-exchange',
      });
      assert.equal(keyExErr.code, ENCRYPTION_ERROR_CODES.KEY_EXCHANGE_FAILED);

      const keyUnavailErr = normalizeEncryptionError(new Error('Key missing'), {
        code: ENCRYPTION_ERROR_CODES.KEY_UNAVAILABLE,
        operation: 'key-store',
      });
      assert.equal(keyUnavailErr.code, ENCRYPTION_ERROR_CODES.KEY_UNAVAILABLE);

      const badCipherErr = normalizeEncryptionError(new Error('Invalid base64'), {
        code: ENCRYPTION_ERROR_CODES.INVALID_CIPHERTEXT,
        operation: 'decrypt',
      });
      assert.equal(badCipherErr.code, ENCRYPTION_ERROR_CODES.INVALID_CIPHERTEXT);
    });

    test('message-crypto throws structured EncryptionError codes on missing key, bad key exchange, and failed decryption', async () => {
      const convId = `conv-err-${Date.now()}`;

      // 1. Missing key -> KEY_UNAVAILABLE
      await assert.rejects(
        () => encryptMessage(convId, 'secret plaintext message'),
        (err) => {
          assert.ok(err instanceof EncryptionError);
          assert.equal(err.code, ENCRYPTION_ERROR_CODES.KEY_UNAVAILABLE);
          return true;
        }
      );

      // 2. Missing peer public key -> KEY_EXCHANGE_FAILED
      const alice = await generateKeyPair();
      await assert.rejects(
        () => establishConversationKey(convId, alice.privateKey, '', ''),
        (err) => {
          assert.ok(err instanceof EncryptionError);
          assert.equal(err.code, ENCRYPTION_ERROR_CODES.KEY_EXCHANGE_FAILED);
          return true;
        }
      );

      // 3. Invalid ciphertext & wrong nonce -> INVALID_CIPHERTEXT / DECRYPTION_FAILED
      const bob = await generateKeyPair();
      await establishConversationKey(
        convId,
        alice.privateKey,
        await exportPublicKeyBase64(bob.publicKey),
        'bob-fp'
      );

      await assert.rejects(
        () => decryptMessage(convId, '', ''),
        (err) => {
          assert.ok(err instanceof EncryptionError);
          assert.equal(err.code, ENCRYPTION_ERROR_CODES.INVALID_CIPHERTEXT);
          return true;
        }
      );

      const encrypted = await encryptMessage(convId, 'top secret');
      const wrongNonce = toBase64Url(crypto.getRandomValues(new Uint8Array(12)).buffer);
      await assert.rejects(
        () => decryptMessage(convId, encrypted.bodyCiphertext, wrongNonce),
        (err) => {
          assert.ok(err instanceof EncryptionError);
          assert.equal(err.code, ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED);
          return true;
        }
      );
    });

    test('decryption failure in messagesStore never exposes ciphertext as plaintext', async () => {
      const convId = `conv-decrypt-safe-${Date.now()}`;
      const fakeCiphertext = 'U2FsdGVkX19mYWtlY2lwaGVydGV4dABC123';
      const fakeNonce = 'ZmFrZW5vbmNlMTIz';

      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            messages: [
              {
                id: 'msg-cipher-1',
                conversationId: convId,
                senderId: 'user-2',
                bodyCiphertext: fakeCiphertext,
                nonce: fakeNonce,
                createdAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const loaded = await messagesStore.loadMessages(convId);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].plaintext, null);
      assert.equal(loaded[0].decryptError, true);
      assert.notEqual(loaded[0].plaintext, fakeCiphertext);
    });
  });

  // ── 3. Page Error Mapping, Contexts & Unknown Code Fallback ────────────────

  describe('3. pageerror — User Message Mapping & Fallback', () => {
    test('maps standard API and encryption error codes to Indonesian user messages', () => {
      assert.equal(
        getPageErrorMessage(PAGE_ERROR_CODES.NETWORK_ERROR),
        'Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi.'
      );
      assert.equal(
        getPageErrorMessage(PAGE_ERROR_CODES.REQUEST_TIMEOUT),
        'Permintaan membutuhkan waktu terlalu lama. Silakan coba lagi.'
      );
      assert.equal(
        getPageErrorMessage(PAGE_ERROR_CODES.UNAUTHORIZED),
        'Sesi Anda telah berakhir. Silakan masuk kembali.'
      );
      assert.equal(
        getPageErrorMessage(PAGE_ERROR_CODES.SERVER_ERROR),
        'Terjadi masalah pada server. Silakan coba lagi nanti.'
      );
      assert.equal(
        getPageErrorMessage(PAGE_ERROR_CODES.VALIDATION_ERROR),
        'Data yang dimasukkan belum sesuai. Periksa kembali data Anda.'
      );
      assert.equal(
        getPageErrorMessage(PAGE_ERROR_CODES.ENCRYPTION_FAILED),
        'Pesan tidak dapat diamankan. Silakan coba lagi.'
      );
      assert.equal(
        getPageErrorMessage(PAGE_ERROR_CODES.DECRYPTION_FAILED),
        'Pesan ini tidak dapat dibuka dengan aman.'
      );
      assert.equal(
        getPageErrorMessage(PAGE_ERROR_CODES.KEY_EXCHANGE_FAILED),
        'Koneksi aman belum dapat dibuat. Silakan coba lagi.'
      );
      assert.equal(
        getPageErrorMessage(PAGE_ERROR_CODES.KEY_UNAVAILABLE),
        'Kunci keamanan yang diperlukan tidak tersedia.'
      );
      assert.equal(
        getPageErrorMessage(PAGE_ERROR_CODES.INVALID_CIPHERTEXT),
        'Pesan tidak dapat diverifikasi atau dibuka dengan aman.'
      );
    });

    test('supports context-specific messages (e.g. login vs default UNAUTHORIZED, attachment vs message ENCRYPTION_FAILED)', () => {
      const loginUnauth = resolvePageError({ code: PAGE_ERROR_CODES.UNAUTHORIZED, source: 'api' }, 'login');
      assert.equal(loginUnauth.code, PAGE_ERROR_CODES.UNAUTHORIZED);
      assert.equal(loginUnauth.userMessage, 'Email atau kata sandi salah. Silakan coba lagi.');

      const sessionUnauth = resolvePageError({ code: PAGE_ERROR_CODES.UNAUTHORIZED, source: 'api' });
      assert.equal(sessionUnauth.userMessage, 'Sesi Anda telah berakhir. Silakan masuk kembali.');

      const attachmentEnc = resolvePageError(
        { code: PAGE_ERROR_CODES.ENCRYPTION_FAILED, source: 'encryption' },
        'attachment'
      );
      assert.equal(
        attachmentEnc.userMessage,
        'Berkas tidak dapat diamankan untuk dikirim. Silakan coba lagi.'
      );
    });

    test('returns UNKNOWN_ERROR fallback for unrecognized codes, null, or raw Error objects without code', () => {
      const expectedFallback = DEFAULT_USER_MESSAGES[PAGE_ERROR_CODES.UNKNOWN_ERROR];

      const unknownStr = resolvePageError('UNREGISTERED_WEIRD_ERROR_999');
      assert.equal(unknownStr.code, PAGE_ERROR_CODES.UNKNOWN_ERROR);
      assert.equal(unknownStr.userMessage, expectedFallback);

      const unknownObj = resolvePageError({ code: 'NOT_A_VALID_CODE', message: 'Raw internal error' });
      assert.equal(unknownObj.code, PAGE_ERROR_CODES.UNKNOWN_ERROR);
      assert.equal(unknownObj.userMessage, expectedFallback);

      const nullRes = resolvePageError(null);
      assert.equal(nullRes.code, PAGE_ERROR_CODES.UNKNOWN_ERROR);
      assert.equal(nullRes.userMessage, expectedFallback);
    });

    test('never uses error.message text matching to determine user message', () => {
      // An Error without a code whose message mimics a network or SQL error must NOT be matched by text
      const rawRuntimeError = new Error(
        'SELECT * FROM users WHERE password="MySecretPassword123" failed: Network request failed'
      );
      const resolved = resolvePageError(rawRuntimeError);
      assert.equal(resolved.code, PAGE_ERROR_CODES.UNKNOWN_ERROR);
      assert.equal(resolved.userMessage, DEFAULT_USER_MESSAGES[PAGE_ERROR_CODES.UNKNOWN_ERROR]);
      assert.equal(resolved.userMessage.includes('SELECT'), false);
      assert.equal(resolved.userMessage.includes('MySecretPassword123'), false);

      const validationErr = createValidationError(PAGE_ERROR_CODES.PASSWORD_TOO_SHORT, 'register');
      assert.equal(validationErr.code, PAGE_ERROR_CODES.PASSWORD_TOO_SHORT);
      assert.equal(validationErr.source, 'validation');
    });
  });

  // ── 4. Security & Log Sanitization Tests ───────────────────────────────────

  describe('4. Security — Sanitization of Logs and UI Outputs', () => {
    const DUMMY_SECRETS = {
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTk5OSIsInJvbGUiOiJhZG1pbiJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      password: 'SuperSecretPassword!2026',
      sessionId: 's%3A9f8e7d6c5b4a3210.secretSessionSignatureXYZ',
      cookie: 'connect.sid=s%3A9f8e7d6c5b4a3210.secretSessionSignatureXYZ',
      privateKeyPem:
        '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7secretKeyMaterial\n-----END PRIVATE KEY-----',
      sharedSecretHex: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      plaintext: 'Pesan rahasia: kode brankas adalah 99887766',
      ciphertext: 'Y2lwaGVydGV4dF9zZWNyZXRfYm9keV9wYXlsb2FkXzk5ODg3Nw',
      nonce: 'bm9uY2Vfc2VjcmV0XzEyX2J5dGVz',
      sqlQuery: "SELECT id, email, password_hash FROM users WHERE email = 'victim@example.com'",
      serverPath: '/var/www/gettalk/backend/src/repositories/users.repository.js:88:15',
    };

    test('sanitizes exceptions containing embedded tokens, passwords, private keys, plaintexts, and URLs in actual console output', () => {
      const poisonedError = new Error(
        `Auth failed for password="${DUMMY_SECRETS.password}" ` +
          `Bearer ${DUMMY_SECRETS.jwt} ` +
          `${DUMMY_SECRETS.cookie} ` +
          `plaintext="${DUMMY_SECRETS.plaintext}" ` +
          `${DUMMY_SECRETS.privateKeyPem} ` +
          `sharedSecret=${DUMMY_SECRETS.sharedSecretHex} ` +
          `at https://api.gettalk.id/api/auth/login?token=${DUMMY_SECRETS.jwt}&sessionId=${DUMMY_SECRETS.sessionId}`
      );

      const apiErr = logApiError(poisonedError, {
        status: 401,
        endpoint: `https://api.gettalk.id/api/auth/login?token=${DUMMY_SECRETS.jwt}&password=${DUMMY_SECRETS.password}`,
        method: 'POST',
        meta: {
          password: DUMMY_SECRETS.password,
          accessToken: DUMMY_SECRETS.jwt,
          cookie: DUMMY_SECRETS.cookie,
          sessionId: DUMMY_SECRETS.sessionId,
          plaintext: DUMMY_SECRETS.plaintext,
          requestBody: { email: 'user@example.com', password: DUMMY_SECRETS.password },
          headers: { Authorization: `Bearer ${DUMMY_SECRETS.jwt}`, Cookie: DUMMY_SECRETS.cookie },
        },
      });

      assert.equal(loggedErrors.length, 1);
      const serializedLogs = JSON.stringify(loggedErrors);
      const uiMessage = getPageErrorMessage(apiErr, 'login');

      for (const [label, secretValue] of Object.entries(DUMMY_SECRETS)) {
        assert.equal(
          serializedLogs.includes(secretValue),
          false,
          `Log output leaked ${label}: ${secretValue}`
        );
        assert.equal(
          uiMessage.includes(secretValue),
          false,
          `UI message leaked ${label}: ${secretValue}`
        );
      }

      // Verify URL query parameters were stripped
      assert.equal(apiErr.endpoint, '/api/auth/login');
      assert.equal(serializedLogs.includes('?token='), false);
    });

    test('sanitizes encryption errors so private keys, shared secrets, plaintexts, ciphertexts, nonces, and salts never appear in logs', () => {
      const poisonedCryptoError = new Error(
        `AES-GCM failed for plaintext="${DUMMY_SECRETS.plaintext}" ` +
          `nonce=${DUMMY_SECRETS.nonce} ` +
          `ciphertext=${DUMMY_SECRETS.ciphertext} ` +
          `privateKey=${DUMMY_SECRETS.privateKeyPem}`
      );

      const encErr = logEncryptionError(poisonedCryptoError, {
        code: ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED,
        operation: 'decrypt',
        conversationId: 'conv-123',
        meta: {
          plaintext: DUMMY_SECRETS.plaintext,
          bodyCiphertext: DUMMY_SECRETS.ciphertext,
          nonce: DUMMY_SECRETS.nonce,
          salt: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
          privateKey: DUMMY_SECRETS.privateKeyPem,
          sharedSecret: DUMMY_SECRETS.sharedSecretHex,
          derivedKey: 'raw-derived-key-secret',
          operation: 'decrypt',
        },
      });

      assert.equal(loggedErrors.length, 1);
      const serializedLogs = JSON.stringify(loggedErrors);
      const uiMessage = getPageErrorMessage(encErr);

      assert.equal(serializedLogs.includes(DUMMY_SECRETS.plaintext), false);
      assert.equal(serializedLogs.includes(DUMMY_SECRETS.ciphertext), false);
      assert.equal(serializedLogs.includes(DUMMY_SECRETS.nonce), false);
      assert.equal(serializedLogs.includes(DUMMY_SECRETS.sharedSecretHex), false);
      assert.equal(serializedLogs.includes('raw-derived-key-secret'), false);
      assert.equal( serializedLogs.includes('MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk'), false);

      assert.equal(uiMessage, 'Pesan ini tidak dapat dibuka dengan aman.');
    });

    test('strips backend internal details (SQL, stack traces, filesystem paths) from both logs and UI on 500 errors', async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              message: `Database error: ${DUMMY_SECRETS.sqlQuery} failed at ${DUMMY_SECRETS.serverPath}`,
              stack: `Error: Database crash\n    at query (${DUMMY_SECRETS.serverPath})`,
            },
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );

      await assert.rejects(
        () => api.post('/api/messages', { bodyCiphertext: 'abc', nonce: '123' }),
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.code, API_ERROR_CODES.SERVER_ERROR);
          assert.equal(err.message.includes('SELECT'), false);
          assert.equal(err.message.includes('users.repository.js'), false);

          const uiMsg = getPageErrorMessage(err);
          assert.equal(uiMsg, 'Terjadi masalah pada server. Silakan coba lagi nanti.');
          return true;
        }
      );

      const serializedLogs = JSON.stringify(loggedErrors);
      assert.equal(serializedLogs.includes(DUMMY_SECRETS.sqlQuery), false);
      assert.equal(serializedLogs.includes(DUMMY_SECRETS.serverPath), false);
    });

    test('sanitizeUrl and metadata sanitizers strip query strings and sensitive fields', () => {
      assert.equal(
        sanitizeUrl('https://chat.gettalk.id/api/auth/reset?token=123456&email=user@test.com#frag'),
        '/api/auth/reset'
      );
      assert.equal(
        sanitizeUrl('/api/users/search?q=secret-user&session_id=xyz'),
        '/api/users/search'
      );

      const cleanApiMeta = sanitizeApiMetadata({
        endpoint: 'http://localhost:3000/api/auth/login?secret=1',
        password: 'my-password',
        token: DUMMY_SECRETS.jwt,
        code: '123456', // numeric OTP code must be redacted
      });
      assert.equal(cleanApiMeta.endpoint, '/api/auth/login');
      assert.equal(cleanApiMeta.password, '[REDACTED]');
      assert.equal(cleanApiMeta.token, '[REDACTED]');
      assert.equal(cleanApiMeta.code, '[REDACTED]');

      const cleanCryptoMeta = sanitizeEncryptionMetadata({
        operation: 'key-exchange',
        privateKey: 'secret-priv',
        sharedSecret: 'secret-shared',
        nonce: 'secret-nonce',
        plaintext: 'secret-text',
      });
      assert.equal(cleanCryptoMeta.operation, 'key-exchange');
      assert.equal(cleanCryptoMeta.privateKey, '[REDACTED]');
      assert.equal(cleanCryptoMeta.sharedSecret, '[REDACTED]');
      assert.equal(cleanCryptoMeta.nonce, '[REDACTED]');
      assert.equal(cleanCryptoMeta.plaintext, '[REDACTED]');
    });
  });

  // ── 5. Store Integration Tests ─────────────────────────────────────────────

  describe('5. Store Integration — Consistent Error Codes & User Messages', () => {
    test('authStore.login records normalized errorCode and user-friendly message without leaking backend internals', async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid password hash comparison in bcrypt',
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );

      await assert.rejects(
        () => authStore.login({ email: 'user@example.com', password: 'wrong' }),
        (err) => {
          assert.equal(err.code, API_ERROR_CODES.INVALID_CREDENTIALS);
          return true;
        }
      );

      const state = get(authStore);
      assert.equal(state.errorCode, API_ERROR_CODES.INVALID_CREDENTIALS);
      assert.equal(
        state.error,
        'Email atau kata sandi salah. Silakan periksa kembali dan coba lagi.'
      );
      // Logged exactly once
      assert.equal(loggedErrors.length, 1);
    });

    test('friendsStore.sendRequest throws USER_NOT_FOUND when username does not exist', async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ users: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      await assert.rejects(
        () => friendsStore.sendRequest({ username: 'nobody_here' }),
        (err) => {
          assert.equal(err.code, API_ERROR_CODES.USER_NOT_FOUND);
          assert.equal(
            getPageErrorMessage(err, 'friends'),
            'Pengguna tidak ditemukan. Periksa kembali username yang dimasukkan.'
          );
          return true;
        }
      );
    });

    test('conversationsStore.loadConversations records user-friendly error on 500 server failure', async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Redis cluster down' } }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );

      const list = await conversationsStore.loadConversations();
      assert.deepEqual(list, []);

      const state = get(conversationsStore);
      assert.equal(state.errorCode, API_ERROR_CODES.SERVER_ERROR);
      assert.equal(state.error, 'Terjadi masalah pada server. Silakan coba lagi nanti.');
      assert.equal(loggedErrors.length, 1);
    });
  });
});
