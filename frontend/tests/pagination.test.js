process.env.VITE_APP_ENV = process.env.VITE_APP_ENV || 'development';
process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
process.env.VITE_SOCKET_URL = process.env.VITE_SOCKET_URL || 'http://localhost:3000';

import 'fake-indexeddb/auto';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';

import { generateKeyPair, exportPublicKeyBase64 } from '../src/services/crypto/ecdh.js';
import {
  establishConversationKey,
  encryptMessage,
  clearCryptoState,
} from '../src/services/crypto/message-crypto.js';

let listMessages;
let friendLists;
let friendRequestList;
let listConversations;
let searchUsers;
let messagesStore;
let friendsStore;
let conversationsStore;

before(async () => {
  ({ listMessages } = await import('../src/services/api/messages.api.js'));
  ({ friendLists, friendRequestList } = await import('../src/services/api/friends.api.js'));
  ({ listConversations } = await import('../src/services/api/conversations.api.js'));
  ({ searchUsers } = await import('../src/services/api/users.api.js'));
  ({ messagesStore } = await import('../src/stores/messages.store.js'));
  ({ friendsStore } = await import('../src/stores/friends.store.js'));
  ({ conversationsStore } = await import('../src/stores/conversations.store.js'));
});

describe('Frontend Pagination — API Layer & Store Integration (Rule #5, #9, #13)', () => {
  let originalFetch;
  /** @type {{ url: string, options: any }[]} */
  let fetchCalls = [];

  beforeEach(async () => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    await clearCryptoState();
    messagesStore.reset();
    friendsStore.reset();
    conversationsStore.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('API domain services build standardized pagination query strings via client.js (Rule #5)', async () => {
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 20, offset: 0, total: 0, nextCursor: null, hasMore: false },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await listMessages('conv-1', { limit: 50, before: 'cursor-msg-1' });
    await friendLists({ limit: 20, offset: 40 });
    await friendRequestList({ limit: 15, cursor: 'cursor-req-1' });
    await listConversations({ limit: 25, before: 'cursor-conv-1' });
    await searchUsers('alice', { limit: 10, offset: 20 });

    assert.equal(fetchCalls.length, 5);
    assert.ok(fetchCalls[0].url.endsWith('/api/conversations/conv-1/messages?limit=50&before=cursor-msg-1'));
    assert.ok(fetchCalls[1].url.endsWith('/api/friends?limit=20&offset=40'));
    assert.ok(fetchCalls[2].url.endsWith('/api/friends/requests?limit=15&before=cursor-req-1'));
    assert.ok(fetchCalls[3].url.endsWith('/api/conversations?limit=25&before=cursor-conv-1'));
    assert.ok(fetchCalls[4].url.endsWith('/api/users/search?q=alice&limit=10&offset=20'));
  });

  test('messagesStore.loadMessages and loadMoreMessages paginate with nextCursor, cap limit at 50, and prepend without duplicates', async () => {
    const convId = '550e8400-e29b-41d4-a716-446655440000';
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    await establishConversationKey(
      convId,
      alice.privateKey,
      await exportPublicKeyBase64(bob.publicKey),
      'bob-fp'
    );

    const enc1 = await encryptMessage(convId, 'Pesan lama #1');
    const enc2 = await encryptMessage(convId, 'Pesan tengah #2');
    const enc3 = await encryptMessage(convId, 'Pesan baru #3');

    let callIndex = 0;
    globalThis.fetch = async (url) => {
      fetchCalls.push({ url: String(url), options: {} });
      callIndex += 1;

      if (callIndex === 1) {
        // Initial page (newest messages: #3 and #2)
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'msg-3',
                conversationId: convId,
                senderId: 'user-a',
                bodyCiphertext: enc3.bodyCiphertext,
                nonce: enc3.nonce,
                createdAt: '2026-10-01T10:03:00.000Z',
              },
              {
                id: 'msg-2',
                conversationId: convId,
                senderId: 'user-b',
                bodyCiphertext: enc2.bodyCiphertext,
                nonce: enc2.nonce,
                createdAt: '2026-10-01T10:02:00.000Z',
              },
            ],
            pagination: {
              limit: 50,
              nextCursor: 'msg-2',
              hasMore: true,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Second page (older message #1 + intentional duplicate #2 to verify deduplication)
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'msg-2',
              conversationId: convId,
              senderId: 'user-b',
              bodyCiphertext: enc2.bodyCiphertext,
              nonce: enc2.nonce,
              createdAt: '2026-10-01T10:02:00.000Z',
            },
            {
              id: 'msg-1',
              conversationId: convId,
              senderId: 'user-a',
              bodyCiphertext: enc1.bodyCiphertext,
              nonce: enc1.nonce,
              createdAt: '2026-10-01T10:01:00.000Z',
            },
          ],
          pagination: {
            limit: 50,
            nextCursor: null,
            hasMore: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    // Request with limit > 50 must be clamped to 50 per Rule #13
    const initial = await messagesStore.loadMessages(convId, { limit: 999 });
    assert.ok(fetchCalls[0].url.includes('limit=50'));
    assert.equal(initial.length, 2);
    assert.deepEqual(
      initial.map((m) => m.plaintext),
      ['Pesan tengah #2', 'Pesan baru #3']
    );

    let state = get(messagesStore);
    assert.equal(state.nextCursorByConversation[convId], 'msg-2');
    assert.equal(state.hasMoreByConversation[convId], true);

    // Scroll-to-top triggers loadMoreMessages
    const prepended = await messagesStore.loadMoreMessages(convId);
    assert.ok(fetchCalls[1].url.includes('before=msg-2'));
    assert.equal(prepended.length, 1);
    assert.equal(prepended[0].id, 'msg-1');

    state = get(messagesStore);
    assert.equal(state.nextCursorByConversation[convId], null);
    assert.equal(state.hasMoreByConversation[convId], false);
    assert.deepEqual(
      state.messagesByConversation[convId].map((m) => m.plaintext),
      ['Pesan lama #1', 'Pesan tengah #2', 'Pesan baru #3']
    );

    // Subsequent loadMoreMessages is a no-op when hasMore is false
    const noop = await messagesStore.loadMoreMessages(convId);
    assert.equal(noop.length, 0);
    assert.equal(fetchCalls.length, 2);
  });

  test('friendsStore tracks pagination for Friends (offset) and Requests (cursor) and loads next pages', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      fetchCalls.push({ url: urlStr, options: {} });

      if (urlStr.includes('/api/friends/requests?limit=20&before=req-1')) {
        return new Response(
          JSON.stringify({
            data: [{ id: 'req-2', fromUser: { id: 'u-4', username: 'dave' } }],
            pagination: { limit: 20, nextCursor: null, hasMore: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('/api/friends/requests')) {
        return new Response(
          JSON.stringify({
            data: [{ id: 'req-1', fromUser: { id: 'u-3', username: 'carol' } }],
            pagination: { limit: 20, nextCursor: 'req-1', hasMore: true },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('/api/friends?limit=20&offset=1')) {
        return new Response(
          JSON.stringify({
            data: [{ userId: 'u-2', username: 'bob' }],
            pagination: { limit: 20, offset: 1, total: 2, hasMore: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          data: [{ userId: 'u-1', username: 'alice' }],
          pagination: { limit: 20, offset: 0, total: 2, hasMore: true },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await friendsStore.loadAll();
    let state = get(friendsStore);
    assert.equal(state.friends.length, 1);
    assert.equal(state.friendsPagination.total, 2);
    assert.equal(state.friendsPagination.hasMore, true);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requestsPagination.hasMore, true);
    assert.equal(state.requestsPagination.nextCursor, 'req-1');

    await friendsStore.loadMoreFriends();
    await friendsStore.loadMoreRequests();

    state = get(friendsStore);
    assert.deepEqual(
      state.friends.map((f) => f.username),
      ['alice', 'bob']
    );
    assert.equal(state.friendsPagination.hasMore, false);
    assert.deepEqual(
      state.requests.map((r) => r.id),
      ['req-1', 'req-2']
    );
    assert.equal(state.requestsPagination.hasMore, false);
  });

  test('conversationsStore supports lazy cursor pagination via loadMoreConversations', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      fetchCalls.push({ url: urlStr, options: {} });

      if (urlStr.includes('before=conv-1')) {
        return new Response(
          JSON.stringify({
            data: [{ id: 'conv-2', type: 'direct', peer: { id: 'u-2', username: 'bob' } }],
            pagination: { limit: 20, nextCursor: null, hasMore: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          data: [{ id: 'conv-1', type: 'direct', peer: { id: 'u-1', username: 'alice' } }],
          pagination: { limit: 20, nextCursor: 'conv-1', hasMore: true },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await conversationsStore.loadConversations();
    let state = get(conversationsStore);
    assert.equal(state.conversations.length, 1);
    assert.equal(state.hasMore, true);
    assert.equal(state.nextCursor, 'conv-1');

    await conversationsStore.loadMoreConversations();
    state = get(conversationsStore);
    assert.deepEqual(
      state.conversations.map((c) => c.id),
      ['conv-1', 'conv-2']
    );
    assert.equal(state.hasMore, false);
    assert.equal(state.nextCursor, null);
  });
});

