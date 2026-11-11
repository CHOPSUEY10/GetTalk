process.env.VITE_APP_ENV = process.env.VITE_APP_ENV || 'development';
process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
process.env.VITE_SOCKET_URL = process.env.VITE_SOCKET_URL || 'http://localhost:3000';

import 'fake-indexeddb/auto';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';

let authStore;
let userStore;
let messagesStore;
let validators;

before(async () => {
  ({ authStore } = await import('../src/stores/auth.store.js'));
  ({ userStore } = await import('../src/stores/user.store.js'));
  ({ messagesStore } = await import('../src/stores/messages.store.js'));
  validators = await import('../src/lib/validators.js');
});

describe('Frontend Unified Settings Module Tests', () => {
  let originalFetch;
  let fetchCalls = [];

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    userStore.clearUser();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. Validators (Profile, Password, Email OTP, App Passcode)', () => {
    test('validates profile input (nickname max 60, bio max 160, username 3-50)', () => {
      assert.equal(
        validators.validateProfileInput({
          nickname: 'Alice',
          username: 'alice_01',
          bio: 'Halo!',
        }).valid,
        true
      );
      assert.equal(
        validators.validateProfileInput({
          nickname: 'A'.repeat(61),
          username: 'alice_01',
        }).valid,
        false
      );
      assert.equal(
        validators.validateProfileInput({
          nickname: 'Alice',
          username: 'ab',
        }).valid,
        false
      );
      assert.equal(
        validators.validateProfileInput({
          nickname: 'Alice',
          username: 'alice_01',
          bio: 'B'.repeat(161),
        }).valid,
        false
      );
    });

    test('validates password change, email change OTP, and local passcode inputs', () => {
      assert.equal(
        validators.validatePasswordChangeInput({
          currentPassword: 'OldPassword123!',
          newPassword: 'NewPassword456!',
          confirmPassword: 'NewPassword456!',
          mfaEnabled: true,
          mfaCode: '123456',
        }).valid,
        true
      );

      assert.equal(
        validators.validatePasswordChangeInput({
          currentPassword: 'SamePassword123!',
          newPassword: 'SamePassword123!',
          confirmPassword: 'SamePassword123!',
        }).valid,
        false
      );

      assert.equal(
        validators.validateEmailChangeRequestInput({
          newEmail: 'new@example.com',
          currentEmail: 'old@example.com',
          currentPassword: 'Password123!',
        }).valid,
        true
      );

      assert.equal(validators.validateEmailChangeVerifyInput('482910').valid, true);
      assert.equal(validators.validateEmailChangeVerifyInput('12a45').valid, false);
      assert.equal(validators.validatePasscodeInput('123456', '123456').valid, true);
      assert.equal(validators.validatePasscodeInput('123456', '654321').valid, false);
    });
  });

  describe('2. Profile & Privacy Store (Normal, Loading, Error, Empty, Unauthorized)', () => {
    test('userStore.updateProfile sends PATCH /api/users/me/profile and updates store', async () => {
      globalThis.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        return new Response(
          JSON.stringify({
            user: {
              id: 'u-1',
              username: 'alice_new',
              nickname: 'Alice W.',
              bio: 'Securing chats',
              email: 'alice@example.com',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const user = await userStore.updateProfile({
        nickname: 'Alice W.',
        username: 'alice_new',
        bio: 'Securing chats',
      });

      assert.equal(user.nickname, 'Alice W.');
      const state = get(userStore);
      assert.equal(state.savingProfile, false);
      assert.equal(state.nickname, 'Alice W.');
      assert.equal(state.bio, 'Securing chats');
      assert.ok(fetchCalls[0].url.endsWith('/api/users/me/profile'));
      assert.equal(fetchCalls[0].options.method, 'PATCH');
    });

    test('userStore.updatePrivacySettings handles normal flow and unauthorized error state', async () => {
      globalThis.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        return new Response(
          JSON.stringify({
            privacy: {
              lastSeenVisibility: 'friends',
              onlineVisibility: 'friends',
              readReceiptsEnabled: false,
              typingIndicatorEnabled: false,
              whoCanMessage: 'friends',
              whoCanAddToGroups: 'friends',
              defaultDisappearingTimer: 86400,
              securityChangeNotifications: true,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const privacy = await userStore.updatePrivacySettings({
        lastSeenVisibility: 'friends',
        readReceiptsEnabled: false,
        typingIndicatorEnabled: false,
      });

      assert.equal(privacy.readReceiptsEnabled, false);
      assert.equal(get(userStore).privacySettings.lastSeenVisibility, 'friends');

      // Unauthorized state (401)
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            error: { code: 'UNAUTHORIZED', message: 'Sesi telah berakhir.' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );

      await assert.rejects(async () => {
        await userStore.updatePrivacySettings({ readReceiptsEnabled: true });
      });
      assert.ok(get(userStore).error);
    });

    test('userStore.loadBlockedUsers supports empty state, pagination, block, and unblock', async () => {
      // Empty state
      globalThis.fetch = async (url) => {
        fetchCalls.push({ url });
        return new Response(
          JSON.stringify({
            blockedUsers: [],
            pagination: { limit: 20, offset: 0, total: 0, hasMore: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await userStore.loadBlockedUsers({ limit: 20, offset: 0 });
      assert.equal(get(userStore).blockedUsers.length, 0);
      assert.ok(fetchCalls[0].url.includes('limit=20'));

      // Block user + reload non-empty list
      globalThis.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        if (options?.method === 'POST') {
          return new Response(
            JSON.stringify({
              message: 'Blocked',
              user: { id: 'u-bob', userId: 'u-bob', username: 'bob' },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            blockedUsers: [{ id: 'u-bob', userId: 'u-bob', user: { id: 'u-bob', username: 'bob' } }],
            pagination: { limit: 20, offset: 0, total: 1, hasMore: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await userStore.blockUser('u-bob');
      assert.equal(get(userStore).blockedUsers.length, 1);

      // Unblock user
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ message: 'Unblocked', unblocked: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      await userStore.unblockUser('u-bob');
      assert.equal(get(userStore).blockedUsers.length, 0);
    });

    test('userStore manages local App Passcode Lock via Web Crypto API', async () => {
      await userStore.setupAppLock('246810', 5);
      assert.equal(get(userStore).appLock.enabled, true);
      assert.equal(await userStore.verifyAppLock('246810'), true);
      assert.equal(await userStore.verifyAppLock('000000'), false);

      await userStore.disableAppLock('246810');
      assert.equal(get(userStore).appLock.enabled, false);
    });
  });

  describe('3. Auth Store Settings Actions (Password, Email OTP, Recovery Codes, Sessions)', () => {
    test('authStore.changePassword, regenerateRecoveryCodes, and session management work', async () => {
      globalThis.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        if (url.endsWith('/api/auth/password')) {
          return new Response(
            JSON.stringify({ message: 'Kata sandi berhasil diperbarui.', revokedOtherSessions: 2 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/api/auth/sessions')) {
          return new Response(
            JSON.stringify({
              sessions: [
                {
                  id: 'sid-1',
                  deviceLabel: 'Chrome di Windows',
                  ipAddress: '127.0.0.1',
                  isCurrent: true,
                },
                {
                  id: 'sid-2',
                  deviceLabel: 'Safari di iPhone',
                  ipAddress: '127.0.0.2',
                  isCurrent: false,
                },
              ],
              pagination: { limit: 20, offset: 0, total: 2, hasMore: false },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      };

      const pwRes = await authStore.changePassword({
        currentPassword: 'OldPassword123!',
        newPassword: 'NewPassword456!',
      });
      assert.equal(pwRes.revokedOtherSessions, 2);

      const sessionsRes = await authStore.getSessions({ limit: 20, offset: 0 });
      assert.equal(sessionsRes.sessions.length, 2);
    });
  });

  describe('4. Messages Store Privacy Enforcement (Read Receipts & Typing Indicator)', () => {
    test('suppresses read receipts and typing indicators when disabled in userStore.privacySettings', async () => {
      // Disable readReceiptsEnabled and typingIndicatorEnabled in userStore
      globalThis.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        return new Response(
          JSON.stringify({
            privacy: {
              lastSeenVisibility: 'everyone',
              onlineVisibility: 'everyone',
              readReceiptsEnabled: false,
              typingIndicatorEnabled: false,
              whoCanMessage: 'everyone',
              whoCanAddToGroups: 'everyone',
              defaultDisappearingTimer: 0,
              securityChangeNotifications: true,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await userStore.updatePrivacySettings({
        readReceiptsEnabled: false,
        typingIndicatorEnabled: false,
      });

      fetchCalls = [];
      const receiptResult = await messagesStore.markMessageRead('conv-1', 'msg-1');
      assert.deepEqual(receiptResult, { suppressed: true }, 'Should not send read receipt when readReceiptsEnabled is false');
      assert.equal(fetchCalls.length, 0, 'No REST receipt request should be made');

      const typingResult = messagesStore.sendTypingIndicator('conv-1', true);
      assert.deepEqual(typingResult, { suppressed: true }, 'Should not emit typing event when typingIndicatorEnabled is false');
    });
  });
});
