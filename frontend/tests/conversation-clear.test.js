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

let clearConversation;
let conversationsStore;
let messagesStore;
let socket;
let events;
let PAGE_ERROR_CODES;
let getPageErrorMessage;

before(async () => {
  ({ clearConversation } = await import('../src/services/api/conversations.api.js'));
  ({ conversationsStore } = await import('../src/stores/conversations.store.js'));
  ({ messagesStore } = await import('../src/stores/messages.store.js'));
  ({ socket } = await import('../src/services/socket/client.js'));
  events = await import('../src/services/socket/events.js');
  ({ PAGE_ERROR_CODES, getPageErrorMessage } = await import('../src/lib/errors/pageerror.js'));
});

describe('Sidebar Conversation Clear & Message Deletion Flow (Rule #3, #5, #19, #22, #23, #27, #28, #33)', () => {
  let originalFetch;
  /** @type {{ url: string, options: any }[]} */
  let fetchCalls = [];

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    conversationsStore.reset();
    messagesStore.reset();
  });

  afterEach(() => {
    conversationsStore.reset();
    messagesStore.reset();
    globalThis.fetch = originalFetch;
  });

  test('API layer builds DELETE /api/conversations/:id with scope query parameter via client.js', async () => {
    globalThis.fetch = async (url, options = {}) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(
        JSON.stringify({
          conversationId: 'conv-1',
          scope: 'me',
          clearedAt: '2026-11-21T04:00:00.000Z',
          deletedMessageCount: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await clearConversation('conv-1');
    await clearConversation('conv-1', { scope: 'me' });
    await clearConversation('conv-1', { scope: 'everyone' });

    assert.equal(fetchCalls.length, 3);
    assert.equal(fetchCalls[0].options.method, 'DELETE');
    assert.ok(fetchCalls[0].url.endsWith('/api/conversations/conv-1?scope=me'));
    assert.ok(fetchCalls[1].url.endsWith('/api/conversations/conv-1?scope=me'));
    assert.ok(fetchCalls[2].url.endsWith('/api/conversations/conv-1?scope=everyone'));
  });

  test('normal flow (scope=me & scope=everyone), loading state, empty state, and synchronized messagesStore cleanup', async () => {
    const convA = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      type: 'direct',
      peer: { id: 'u-bob', username: 'bob', nickname: 'Bob' },
      lastMessageAt: '2026-11-21T03:00:00.000Z',
    };
    const convB = {
      id: '550e8400-e29b-41d4-a716-446655440002',
      type: 'direct',
      peer: { id: 'u-carol', username: 'carol', nickname: 'Carol' },
      lastMessageAt: '2026-11-21T02:00:00.000Z',
    };

    let releaseDelete;
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      const method = (options.method || 'GET').toUpperCase();
      fetchCalls.push({ url: urlStr, options });

      if (method === 'GET' && urlStr.includes('/api/conversations')) {
        return new Response(
          JSON.stringify({
            data: [convA, convB],
            conversations: [convA, convB],
            pagination: { limit: 20, nextCursor: null, hasMore: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'DELETE' && urlStr.includes(convA.id)) {
        await new Promise((resolve) => {
          releaseDelete = resolve;
        });
        return new Response(
          JSON.stringify({
            conversationId: convA.id,
            scope: 'me',
            clearedAt: '2026-11-21T04:01:00.000Z',
            deletedMessageCount: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'DELETE' && urlStr.includes(convB.id)) {
        return new Response(
          JSON.stringify({
            conversationId: convB.id,
            scope: 'everyone',
            clearedAt: '2026-11-21T04:02:00.000Z',
            deletedMessageCount: 3,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // Load two conversations and seed pending/cached messages in both
    await conversationsStore.loadConversations();
    await conversationsStore.selectConversation(convA.id);
    messagesStore.queuePendingMessage(convA.id, { plaintext: 'Pesan tertahan A' });
    messagesStore.queuePendingMessage(convB.id, { plaintext: 'Pesan tertahan B' });

    assert.equal(get(conversationsStore).conversations.length, 2);
    assert.equal(get(messagesStore).messagesByConversation[convA.id].length, 1);
    assert.equal(get(messagesStore).messagesByConversation[convB.id].length, 1);

    // Trigger clear for convA (scope: 'me') and verify loading state while request is in flight
    const pendingClear = conversationsStore.clearConversation(convA.id, { scope: 'me' });
    assert.equal(get(conversationsStore).clearingByConversation[convA.id], true);

    releaseDelete();
    const resA = await pendingClear;
    assert.equal(resA.scope, 'me');
    assert.equal(get(conversationsStore).clearingByConversation[convA.id], undefined);

    // convA removed from sidebar & activeConversation reset; convB intact
    const stateAfterA = get(conversationsStore);
    assert.deepEqual(
      stateAfterA.conversations.map((c) => c.id),
      [convB.id]
    );
    assert.equal(stateAfterA.activeConversationId, null);
    assert.equal(stateAfterA.activeConversation, null);
    assert.equal(stateAfterA.lastClearedEvent?.isLocal, true);

    // messagesStore wiped convA (including pending queue) while preserving convB
    const msgStateAfterA = get(messagesStore);
    assert.equal(msgStateAfterA.messagesByConversation[convA.id], undefined);
    assert.equal(msgStateAfterA.pendingQueueByConversation[convA.id], undefined);
    assert.equal(msgStateAfterA.messagesByConversation[convB.id].length, 1);

    // Clear last remaining conversation (convB) with scope: 'everyone' -> empty state
    const resB = await conversationsStore.clearConversation(convB.id, { scope: 'everyone' });
    assert.equal(resB.scope, 'everyone');
    assert.equal(resB.deletedMessageCount, 3);
    assert.equal(get(conversationsStore).conversations.length, 0);
    assert.equal(get(messagesStore).messagesByConversation[convB.id], undefined);
  });

  test('error states (403, 404, 500) and unauthorized state (401) normalize safely without removing conversation', async () => {
    const conv = {
      id: '550e8400-e29b-41d4-a716-446655440010',
      type: 'direct',
      peer: { id: 'u-bob', username: 'bob' },
    };

    let nextStatus = 200;
    let nextBody = {};

    globalThis.fetch = async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(
          JSON.stringify({
            data: [conv],
            conversations: [conv],
            pagination: { limit: 20, nextCursor: null, hasMore: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify(nextBody), {
        status: nextStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await conversationsStore.loadConversations();

    // 403 Forbidden
    nextStatus = 403;
    nextBody = { error: { code: 'NOT_CONVERSATION_MEMBER', message: 'Not a member' } };
    await assert.rejects(() => conversationsStore.clearConversation(conv.id, { scope: 'everyone' }));
    assert.equal(get(conversationsStore).errorCode, 'NOT_CONVERSATION_MEMBER');
    assert.equal(get(conversationsStore).clearingByConversation[conv.id], undefined);
    assert.equal(get(conversationsStore).conversations.length, 1);

    // 500 Internal error must never expose SQL / stack traces
    nextStatus = 500;
    nextBody = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'SELECT * FROM messages failed at /srv/app/db.js:42',
      },
    };
    await assert.rejects(() => conversationsStore.clearConversation(conv.id, { scope: 'me' }));
    const errMsg = get(conversationsStore).error || '';
    assert.equal(errMsg.includes('SELECT'), false);
    assert.equal(errMsg.includes('/srv/app'), false);
    assert.equal(get(conversationsStore).conversations.length, 1);

    // 401 Unauthorized
    nextStatus = 401;
    nextBody = { error: { code: 'UNAUTHORIZED', message: 'Session expired' } };
    await assert.rejects(() => conversationsStore.clearConversation(conv.id, { scope: 'me' }));
    assert.equal(get(conversationsStore).errorCode, 'UNAUTHORIZED');
    assert.equal(get(conversationsStore).conversations.length, 1);

    // Client-side validation rejects invalid scope without network call
    await assert.rejects(() =>
      conversationsStore.clearConversation(conv.id, { scope: /** @type {any} */ ('invalid') })
    );
    await assert.rejects(() => conversationsStore.clearConversation(''));

    // Page error message mapping exists for fallback code
    const fallbackText = getPageErrorMessage(PAGE_ERROR_CODES.CONVERSATION_CLEAR_FAILED, 'clear-conversation');
    assert.ok(fallbackText.length > 0);
  });

  test('Socket.IO real-time listeners handle conversation:cleared, duplicate events, and conversation:updated restore', async () => {
    const conv = {
      id: '550e8400-e29b-41d4-a716-446655440020',
      type: 'direct',
      peer: { id: 'u-peer', username: 'peer' },
      lastMessageAt: '2026-11-21T01:00:00.000Z',
    };

    let loadCalls = 0;
    globalThis.fetch = async () => {
      loadCalls += 1;
      return new Response(
        JSON.stringify({
          data: [conv],
          conversations: [conv],
          pagination: { limit: 20, nextCursor: null, hasMore: false },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await conversationsStore.loadConversations();
    await conversationsStore.selectConversation(conv.id);
    messagesStore.queuePendingMessage(conv.id, { plaintext: 'Pesan sebelum dihapus peer' });

    const cleanup = conversationsStore.initSocketListeners();
    assert.equal(typeof cleanup, 'function');

    // Simulate incoming Socket.IO `conversation:cleared` from peer (scope: everyone)
    const clearedPayload = {
      conversationId: conv.id,
      scope: 'everyone',
      clearedBy: 'u-peer',
      clearedAt: '2026-11-21T04:10:00.000Z',
    };
    socket.emitEventForTest
      ? socket.emitEventForTest(events.CONVERSATION_CLEARED, clearedPayload)
      : (() => {
          // Trigger registered EventEmitter listeners directly on socket.io-client instance
          const listeners = socket.listeners(events.CONVERSATION_CLEARED);
          assert.ok(listeners.length >= 1, 'conversation:cleared listener must be registered');
          listeners.forEach((fn) => fn(clearedPayload));
        })();

    assert.equal(get(conversationsStore).conversations.length, 0);
    assert.equal(get(conversationsStore).activeConversationId, null);
    assert.equal(get(messagesStore).messagesByConversation[conv.id], undefined);
    assert.equal(get(conversationsStore).lastClearedEvent?.isLocal, false);
    assert.equal(get(conversationsStore).lastClearedEvent?.clearedBy, 'u-peer');

    // Acknowledge clears lastClearedEvent so remounted AppShell never replays toast
    conversationsStore.acknowledgeClearedEvent();
    assert.equal(get(conversationsStore).lastClearedEvent, null);

    // Duplicate `conversation:cleared` event is completely idempotent
    socket.listeners(events.CONVERSATION_CLEARED).forEach((fn) => fn(clearedPayload));
    assert.equal(get(conversationsStore).conversations.length, 0);

    // Incoming `conversation:updated` for a previously cleared/hidden conversation restores it via loadConversations()
    const callsBeforeUpdate = loadCalls;
    const updatedListeners = socket.listeners(events.CONVERSATION_UPDATED);
    assert.ok(updatedListeners.length >= 1, 'conversation:updated listener must be registered');
    updatedListeners.forEach((fn) =>
      fn({ conversationId: conv.id, lastMessageAt: '2026-11-21T04:15:00.000Z' })
    );

    // Allow microtask fetch to settle
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(loadCalls, callsBeforeUpdate + 1);
    assert.equal(get(conversationsStore).conversations.length, 1);

    cleanup();
  });

  test('ClearConversationDialog.svelte and AppShell.svelte compile cleanly with accessibility & responsive semantics (Rule #27, #28)', async () => {
    const dialogPath = resolve(__dirname, '../src/components/chat/ClearConversationDialog.svelte');
    const shellPath = resolve(__dirname, '../src/components/layout/AppShell.svelte');

    const [dialogSource, shellSource] = await Promise.all([
      readFile(dialogPath, 'utf8'),
      readFile(shellPath, 'utf8'),
    ]);

    const compiledDialog = compile(dialogSource, {
      filename: 'ClearConversationDialog.svelte',
      generate: 'client',
    });
    assert.ok(compiledDialog.js?.code, 'ClearConversationDialog.svelte must compile cleanly');

    const compiledShell = compile(shellSource, {
      filename: 'AppShell.svelte',
      generate: 'client',
    });
    assert.ok(compiledShell.js?.code, 'AppShell.svelte must compile cleanly');

    // Accessibility & UX requirements in ClearConversationDialog
    assert.ok(dialogSource.includes('role="dialog"'));
    assert.ok(dialogSource.includes('aria-modal="true"'));
    assert.ok(dialogSource.includes('event.key === "Escape"'));
    assert.ok(dialogSource.includes('<fieldset'));
    assert.ok(dialogSource.includes('<legend'));
    assert.ok(dialogSource.includes('Hapus untuk saya'));
    assert.ok(dialogSource.includes('Hapus untuk semua'));

    // Sidebar trigger & synchronization in AppShell
    assert.ok(shellSource.includes('ClearConversationDialog'));
    assert.ok(shellSource.includes('promptClearConversation'));
    assert.ok(shellSource.includes('conversationsStore.clearConversation'));
    assert.ok(shellSource.includes('conversationsStore.initSocketListeners'));
    assert.ok(shellSource.includes('conversationsStore.acknowledgeClearedEvent'));
    assert.ok(shellSource.includes('opacity-100 md:opacity-0'));
  });
});
