process.env.VITE_APP_ENV = process.env.VITE_APP_ENV || 'development';
process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
process.env.VITE_SOCKET_URL = process.env.VITE_SOCKET_URL || 'http://localhost:3000';

import 'fake-indexeddb/auto';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { get } from 'svelte/store';

const __dirname = dirname(fileURLToPath(import.meta.url));

let presenceLib;
let socketStore;
let socket;
let events;
let conversationsStore;
let friendsStore;
let userStore;

before(async () => {
  presenceLib = await import('../src/lib/presence.js');
  ({ socketStore, socket } = await import('../src/stores/socket.store.js'));
  events = await import('../src/services/socket/events.js');
  ({ conversationsStore } = await import('../src/stores/conversations.store.js'));
  ({ friendsStore } = await import('../src/stores/friends.store.js'));
  ({ userStore } = await import('../src/stores/user.store.js'));
});

describe('Frontend Presence & Last Seen Synchronization (Rule #18, #19, #24, #27, #28, #33)', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    conversationsStore.reset();
    friendsStore.reset();
    userStore.clearUser();
    socketStore.disconnect();
  });

  afterEach(() => {
    conversationsStore.reset();
    friendsStore.reset();
    userStore.clearUser();
    socketStore.disconnect();
    globalThis.fetch = originalFetch;
  });

  test('formatLastSeen formats today, yesterday, older dates, and handles invalid inputs safely', () => {
    const now = new Date(2026, 10, 21, 14, 30, 0); // 21 Nov 2026 14:30 local
    const sameDay = new Date(2026, 10, 21, 11, 15, 0);
    const yesterday = new Date(2026, 10, 20, 22, 5, 0);
    const older = new Date(2026, 10, 10, 9, 0, 0);

    const todayFull = presenceLib.formatLastSeen(sameDay, { now });
    const todayCompact = presenceLib.formatLastSeen(sameDay, { now, compact: true });
    assert.ok(todayFull?.startsWith('Terakhir dilihat hari ini pukul '));
    assert.ok(todayCompact?.startsWith('Terakhir dilihat '));

    const yestFull = presenceLib.formatLastSeen(yesterday, { now });
    const yestCompact = presenceLib.formatLastSeen(yesterday, { now, compact: true });
    assert.ok(yestFull?.startsWith('Terakhir dilihat kemarin pukul '));
    assert.ok(yestCompact?.startsWith('Kemarin, '));

    const olderFull = presenceLib.formatLastSeen(older, { now });
    assert.ok(olderFull?.startsWith('Terakhir dilihat '));

    assert.equal(presenceLib.formatLastSeen(null), null);
    assert.equal(presenceLib.formatLastSeen('not-a-date'), null);
  });

  test('resolvePeerPresence synchronizes live peer status and forces offline + lastSeen when local session is inactive/disconnected', () => {
    const peer = {
      id: 'u-bob',
      username: 'bob',
      isOnline: false,
      lastSeenAt: '2026-11-21T03:00:00.000Z',
    };

    const liveOnlineMap = {
      'u-bob': { isOnline: true, lastSeenAt: '2026-11-21T03:00:00.000Z' },
    };

    // Both local user and peer active -> peer is Online
    const bothActive = presenceLib.resolvePeerPresence({
      peer,
      presenceMap: liveOnlineMap,
      selfConnected: true,
      selfActive: true,
    });
    assert.equal(bothActive.isOnline, true);

    // Local user disconnected -> NEVER shows peer as active; shows peer lastSeenAt
    const selfDisconnected = presenceLib.resolvePeerPresence({
      peer,
      presenceMap: liveOnlineMap,
      selfConnected: false,
      selfActive: true,
    });
    assert.equal(selfDisconnected.isOnline, false);
    assert.equal(selfDisconnected.lastSeenAt, '2026-11-21T03:00:00.000Z');

    // Local user inactive (e.g. tab hidden / idle / locked) -> shows lastSeenAt instead of active
    const selfInactive = presenceLib.resolvePeerPresence({
      peer,
      presenceMap: liveOnlineMap,
      selfConnected: true,
      selfActive: false,
    });
    assert.equal(selfInactive.isOnline, false);
    assert.equal(selfInactive.lastSeenAt, '2026-11-21T03:00:00.000Z');

    // Peer went offline -> shows peer's updated lastSeenAt
    const peerOffline = presenceLib.resolvePeerPresence({
      peer,
      presenceMap: {
        'u-bob': { isOnline: false, lastSeenAt: '2026-11-21T04:10:00.000Z' },
      },
      selfConnected: true,
      selfActive: true,
    });
    assert.equal(peerOffline.isOnline, false);
    assert.equal(peerOffline.lastSeenAt, '2026-11-21T04:10:00.000Z');
  });

  test('Socket.IO user:online / user:offline events sync socketStore, conversationsStore, and friendsStore (including duplicates, out-of-order, and disconnect)', async () => {
    const conv = {
      id: 'conv-1',
      type: 'direct',
      peer: {
        id: 'u-peer',
        username: 'bob',
        isOnline: false,
        lastSeenAt: '2026-11-21T03:00:00.000Z',
      },
      lastMessageAt: '2026-11-21T02:00:00.000Z',
    };
    const friend = {
      userId: 'u-peer',
      username: 'bob',
      isOnline: false,
      lastSeenAt: '2026-11-21T03:00:00.000Z',
    };

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/conversations')) {
        return new Response(
          JSON.stringify({
            data: [conv],
            conversations: [conv],
            pagination: { limit: 20, nextCursor: null, hasMore: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('/api/friends/requests')) {
        return new Response(
          JSON.stringify({ data: [], requests: [], pagination: { limit: 20, nextCursor: null, hasMore: false } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          data: [friend],
          friends: [friend],
          pagination: { limit: 20, offset: 0, total: 1, hasMore: false },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await conversationsStore.loadConversations();
    await conversationsStore.selectConversation('conv-1');
    await friendsStore.loadAll();

    const cleanupConv = conversationsStore.initSocketListeners();
    const cleanupFriends = friendsStore.initSocketListeners();

    try {
      // Seeded initial state from REST
      assert.equal(get(socketStore).presenceByUserId['u-peer']?.isOnline, false);
      assert.equal(get(socketStore).presenceByUserId['u-peer']?.lastSeenAt, '2026-11-21T03:00:00.000Z');

      // 1. Incoming `user:online` updates all three stores
      const onlinePayload = {
        userId: 'u-peer',
        isOnline: true,
        lastSeenAt: '2026-11-21T03:00:00.000Z',
      };
      socket.listeners(events.USER_ONLINE).forEach((fn) => fn(onlinePayload));

      assert.equal(get(socketStore).presenceByUserId['u-peer']?.isOnline, true);
      assert.equal(get(conversationsStore).conversations[0].peer.isOnline, true);
      assert.equal(get(conversationsStore).activeConversation.peer.isOnline, true);
      assert.equal(get(friendsStore).friends[0].isOnline, true);

      // 2. Duplicate `user:online` is idempotent
      const prevMapRef = get(socketStore).presenceByUserId;
      socket.listeners(events.USER_ONLINE).forEach((fn) => fn(onlinePayload));
      assert.equal(get(socketStore).presenceByUserId, prevMapRef);

      // 3. Incoming `user:offline` updates to offline + fresh lastSeenAt across all stores
      const offlinePayload = {
        userId: 'u-peer',
        isOnline: false,
        lastSeenAt: '2026-11-21T04:15:00.000Z',
      };
      socket.listeners(events.USER_OFFLINE).forEach((fn) => fn(offlinePayload));

      assert.equal(get(socketStore).presenceByUserId['u-peer']?.isOnline, false);
      assert.equal(get(socketStore).presenceByUserId['u-peer']?.lastSeenAt, '2026-11-21T04:15:00.000Z');
      assert.equal(get(conversationsStore).conversations[0].peer.isOnline, false);
      assert.equal(get(conversationsStore).activeConversation.peer.lastSeenAt, '2026-11-21T04:15:00.000Z');
      assert.equal(get(friendsStore).friends[0].isOnline, false);
      assert.equal(get(friendsStore).friends[0].lastSeenAt, '2026-11-21T04:15:00.000Z');

      // 4. Out-of-order older `user:offline` must NOT regress lastSeenAt
      socket.listeners(events.USER_OFFLINE).forEach((fn) =>
        fn({
          userId: 'u-peer',
          isOnline: false,
          lastSeenAt: '2026-11-21T04:05:00.000Z',
        })
      );
      assert.equal(get(socketStore).presenceByUserId['u-peer']?.lastSeenAt, '2026-11-21T04:15:00.000Z');
      assert.equal(get(conversationsStore).activeConversation.peer.lastSeenAt, '2026-11-21T04:15:00.000Z');

      // 5. Privacy-hidden `lastSeenAt: null` clears lastSeenAt explicitly
      socket.listeners(events.USER_OFFLINE).forEach((fn) =>
        fn({
          userId: 'u-peer',
          isOnline: false,
          lastSeenAt: null,
        })
      );
      assert.equal(get(socketStore).presenceByUserId['u-peer']?.lastSeenAt, null);
      assert.equal(get(conversationsStore).activeConversation.peer.lastSeenAt, null);

      // 6. Socket disconnect forces peers offline while preserving known lastSeenAt and recording selfLastSeenAt
      socket.listeners(events.USER_ONLINE).forEach((fn) =>
        fn({
          userId: 'u-peer',
          isOnline: true,
          lastSeenAt: '2026-11-21T04:20:00.000Z',
        })
      );
      assert.equal(get(socketStore).presenceByUserId['u-peer']?.isOnline, true);

      socket.listeners('disconnect').forEach((fn) => fn('transport close'));
      const afterDisconnect = get(socketStore);
      assert.equal(afterDisconnect.connected, false);
      assert.equal(afterDisconnect.selfActive, false);
      assert.ok(afterDisconnect.selfLastSeenAt, 'selfLastSeenAt should be recorded on disconnect');
      assert.equal(afterDisconnect.presenceByUserId['u-peer']?.isOnline, false);
      assert.equal(afterDisconnect.presenceByUserId['u-peer']?.lastSeenAt, '2026-11-21T04:20:00.000Z');
      assert.equal(get(conversationsStore).activeConversation.peer.isOnline, false);
      assert.equal(get(friendsStore).friends[0].isOnline, false);
    } finally {
      cleanupConv();
      cleanupFriends();
    }
  });

  test('socketStore.setLocalActivity and syncPresence emit presence:update / presence:sync cleanly', async () => {
    /** @type {Array<{ event: string, payload: any }>} */
    const emitted = [];
    const originalConnectedDescriptor = Object.getOwnPropertyDescriptor(socket, 'connected');
    const originalEmit = socket.emit.bind(socket);

    Object.defineProperty(socket, 'connected', { value: true, configurable: true });
    socket.emit = (event, payload, cb) => {
      emitted.push({ event, payload });
      if (event === events.PRESENCE_UPDATE && typeof cb === 'function') {
        cb({
          success: true,
          isOnline: Boolean(payload?.active),
          lastSeenAt: payload?.active ? null : '2026-11-21T04:30:00.000Z',
        });
      }
      if (event === events.PRESENCE_SYNC && typeof cb === 'function') {
        cb({
          success: true,
          presence: {
            'u-peer-2': { isOnline: true, lastSeenAt: '2026-11-21T04:00:00.000Z' },
          },
        });
      }
      return socket;
    };

    try {
      await socketStore.setLocalActivity(false);
      assert.equal(get(socketStore).selfActive, false);
      assert.equal(get(socketStore).selfLastSeenAt, '2026-11-21T04:30:00.000Z');
      assert.equal(emitted[0].event, events.PRESENCE_UPDATE);
      assert.deepEqual(emitted[0].payload, { active: false });

      await socketStore.setLocalActivity(true);
      assert.equal(get(socketStore).selfActive, true);
      assert.equal(
        emitted.some((e) => e.event === events.PRESENCE_UPDATE && e.payload?.active === true),
        true
      );

      const synced = await socketStore.syncPresence(['u-peer-2']);
      assert.equal(synced['u-peer-2']?.isOnline, true);
      assert.equal(get(socketStore).presenceByUserId['u-peer-2']?.isOnline, true);
    } finally {
      socket.emit = originalEmit;
      if (originalConnectedDescriptor) {
        Object.defineProperty(socket, 'connected', originalConnectedDescriptor);
      } else {
        delete /** @type {any} */ (socket).connected;
      }
    }
  });

  test('Chat.svelte, AppShell.svelte, Home.svelte, Friends.svelte, and PrivacySettingsSection.svelte compile cleanly with presence UI', async () => {
    const files = [
      ['Chat.svelte', '../src/pages/Chat.svelte'],
      ['AppShell.svelte', '../src/components/layout/AppShell.svelte'],
      ['Home.svelte', '../src/pages/Home.svelte'],
      ['Friends.svelte', '../src/pages/Friends.svelte'],
      ['PrivacySettingsSection.svelte', '../src/components/auth/PrivacySettingsSection.svelte'],
    ];

    for (const [filename, relPath] of files) {
      const source = await readFile(resolve(__dirname, relPath), 'utf8');
      const compiled = compile(source, { filename, generate: 'client' });
      assert.ok(compiled.js?.code, `${filename} must compile cleanly`);
    }

    const chatSource = await readFile(resolve(__dirname, '../src/pages/Chat.svelte'), 'utf8');
    assert.ok(chatSource.includes('resolvePeerPresence'));
    assert.ok(chatSource.includes('formatLastSeen'));
    assert.ok(chatSource.includes('socketStore.syncPresence'));
    assert.ok(chatSource.includes('peerIsOnline'));
    assert.ok(chatSource.includes('peerLastSeenText'));

    const shellSource = await readFile(
      resolve(__dirname, '../src/components/layout/AppShell.svelte'),
      'utf8'
    );
    assert.ok(shellSource.includes('resolvePeerPresence'));
    assert.ok(shellSource.includes('selfOnline'));
    assert.ok(shellSource.includes('selfLastSeenCompact'));
  });
});
