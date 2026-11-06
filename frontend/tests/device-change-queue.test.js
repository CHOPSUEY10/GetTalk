process.env.VITE_APP_ENV = process.env.VITE_APP_ENV || 'development';
process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
process.env.VITE_SOCKET_URL = process.env.VITE_SOCKET_URL || 'http://localhost:3000';

import 'fake-indexeddb/auto';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';

import { generateKeyPair, exportPublicKeyBase64 } from '../src/services/crypto/ecdh.js';
import {
  getOrCreateIdentityKeyPair,
  establishConversationKey,
  decryptMessage,
  clearCryptoState,
} from '../src/services/crypto/message-crypto.js';

let establishConversationSession;
let acceptChangedPeerKey;
let assertPeerIdentityKey;
let messagesStore;
let conversationsStore;

before(async () => {
  ({ establishConversationSession } = await import(
    '../src/services/crypto/conversation-session.js'
  ));
  ({ acceptChangedPeerKey, assertPeerIdentityKey } = await import(
    '../src/services/crypto/identity-trust.js'
  ));
  ({ messagesStore } = await import('../src/stores/messages.store.js'));
  ({ conversationsStore } = await import('../src/stores/conversations.store.js'));
});

describe('Outgoing Message Queue & Transmission Hold on Peer Device Change (Rule #15, #16, #17, AC-17)', () => {
  let originalFetch;
  let originalConsoleError;
  /** @type {{ url: string, method: string, body: any }[]} */
  let messagePostCalls = [];

  beforeEach(async () => {
    messagePostCalls = [];
    originalFetch = globalThis.fetch;
    originalConsoleError = console.error;
    // Silence expected IdentityKeyChangedError log lines during tests
    console.error = () => {};

    await clearCryptoState();
    messagesStore.reset();
    conversationsStore.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });

  test('holds outgoing messages in pendingQueue when peer rotates public key and flushes with new session key after approval', async () => {
    const conversationId = 'conv-device-change-1';
    const aliceId = 'user-alice-1';
    const bobId = 'user-bob-1';

    // Alice's local identity key pair (stored in IndexedDB)
    const aliceIdentity = await getOrCreateIdentityKeyPair(aliceId);

    // Bob's initial device (Device 1) and new device after reinstall/device change (Device 2)
    const bobDevice1 = await generateKeyPair();
    const bobDevice1PubBase64 = await exportPublicKeyBase64(bobDevice1.publicKey);

    const bobDevice2 = await generateKeyPair();
    const bobDevice2PubBase64 = await exportPublicKeyBase64(bobDevice2.publicKey);

    // Active public key served by the backend directory for Bob
    let activeBobServerPublicKey = bobDevice1PubBase64;
    let serverMsgCounter = 1;

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      const method = (options.method || 'GET').toUpperCase();

      // Mock GET /api/conversations/:id
      if (urlStr.endsWith(`/api/conversations/${conversationId}`) && method === 'GET') {
        return new Response(
          JSON.stringify({
            conversation: {
              id: conversationId,
              type: 'direct',
              peer: { id: bobId, username: 'bob' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Mock GET /api/users/:userId/identity-key
      if (urlStr.includes(`/api/users/${bobId}/identity-key`) && method === 'GET') {
        return new Response(
          JSON.stringify({
            identityKey: {
              userId: bobId,
              publicKey: activeBobServerPublicKey,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Mock POST /api/conversations/:id/messages
      if (urlStr.endsWith(`/api/conversations/${conversationId}/messages`) && method === 'POST') {
        const parsedBody = options.body ? JSON.parse(options.body) : {};
        messagePostCalls.push({ url: urlStr, method, body: parsedBody });

        return new Response(
          JSON.stringify({
            message: {
              id: `srv-msg-${serverMsgCounter++}`,
              conversationId,
              senderId: aliceId,
              bodyCiphertext: parsedBody.bodyCiphertext,
              nonce: parsedBody.nonce,
              clientMessageId: parsedBody.clientMessageId,
              createdAt: new Date().toISOString(),
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // 1. Initialize E2EE session while Bob is on Device 1 (TOFU pins Bob's Device 1 fingerprint)
    const initRes = await conversationsStore.initE2EESession(conversationId, aliceId);
    assert.equal(initRes.status, 'ready');
    assert.equal(get(conversationsStore).e2eeStatus, 'ready');

    // 2. Send Message 1 while Bob's key is unchanged -> transmitted normally
    const msg1 = await messagesStore.sendMessage(conversationId, {
      plaintext: 'Halo Bob di perangkat pertama!',
      senderId: aliceId,
      senderUsername: 'alice',
    });

    assert.equal(msg1.status, 'sent');
    assert.equal(messagePostCalls.length, 1);
    assert.ok(messagePostCalls[0].body.bodyCiphertext);
    assert.ok(messagePostCalls[0].body.nonce);
    assert.equal(
      (get(messagesStore).pendingQueueByConversation[conversationId] || []).length,
      0
    );

    // Bob's Device 1 can decrypt Message 1
    const bobDevice1ConvId = `${conversationId}-bob-dev1`;
    await establishConversationKey(
      bobDevice1ConvId,
      bobDevice1.privateKey,
      aliceIdentity.publicKeyBase64,
      'alice-fp'
    );
    const decryptedMsg1 = await decryptMessage(
      bobDevice1ConvId,
      messagePostCalls[0].body.bodyCiphertext,
      messagePostCalls[0].body.nonce
    );
    assert.equal(decryptedMsg1, 'Halo Bob di perangkat pertama!');

    // 3. Simulate Bob switching to a new device (Device 2 public key published on backend)
    activeBobServerPublicKey = bobDevice2PubBase64;

    // 4. Alice sends Message 2 and Message 3 -> key change detected, transmission HELD in queue
    const msg2 = await messagesStore.sendMessage(conversationId, {
      plaintext: 'Pesan kedua tertahan saat Bob ganti HP',
      senderId: aliceId,
      senderUsername: 'alice',
    });
    const msg3 = await messagesStore.sendMessage(conversationId, {
      plaintext: 'Pesan ketiga ikut antrean FIFO',
      senderId: aliceId,
      senderUsername: 'alice',
    });

    // Verify neither Message 2 nor Message 3 was sent over the network
    assert.equal(
      messagePostCalls.length,
      1,
      'No ciphertext may be transmitted while peer identity key change is unverified'
    );

    // Verify both messages are in the pending queue with status 'queued'
    assert.equal(msg2.status, 'queued');
    assert.equal(msg2.reason, 'KEY_ROTATION_PENDING_APPROVAL');
    assert.equal(msg3.status, 'queued');

    const stateWhileQueued = get(messagesStore);
    const queue = stateWhileQueued.pendingQueueByConversation[conversationId];
    assert.equal(queue.length, 2);
    assert.equal(queue[0].plaintext, 'Pesan kedua tertahan saat Bob ganti HP');
    assert.equal(queue[0].reason, 'KEY_ROTATION_PENDING_APPROVAL');
    assert.equal(queue[1].plaintext, 'Pesan ketiga ikut antrean FIFO');

    const feedWhileQueued = stateWhileQueued.messagesByConversation[conversationId];
    assert.equal(feedWhileQueued.length, 3);
    assert.equal(feedWhileQueued[1].status, 'queued');
    assert.equal(feedWhileQueued[1].plaintext, 'Pesan kedua tertahan saat Bob ganti HP');
    assert.equal(feedWhileQueued[2].status, 'queued');
    assert.equal(feedWhileQueued[2].plaintext, 'Pesan ketiga ikut antrean FIFO');

    // Verify conversationsStore transitioned to 'keyChange' security alert state
    const convStateDuringChange = get(conversationsStore);
    assert.equal(convStateDuringChange.e2eeStatus, 'keyChange');
    assert.ok(convStateDuringChange.keyChange);
    assert.equal(convStateDuringChange.keyChange.userId, bobId);
    assert.notEqual(
      convStateDuringChange.keyChange.previousFingerprint,
      convStateDuringChange.keyChange.fingerprint
    );

    // 5. Alice verifies and accepts Bob's new key (`acceptChangedPeerKey` + `flushPendingMessages`)
    await acceptChangedPeerKey(bobId);
    const flushed = await messagesStore.flushPendingMessages(conversationId);

    assert.equal(flushed.length, 2);
    assert.equal(flushed[0].status, 'sent');
    assert.equal(flushed[0].plaintext, 'Pesan kedua tertahan saat Bob ganti HP');
    assert.equal(flushed[1].status, 'sent');
    assert.equal(flushed[1].plaintext, 'Pesan ketiga ikut antrean FIFO');

    // Verify pending queue is now empty and both messages were transmitted in FIFO order
    const stateAfterFlush = get(messagesStore);
    assert.equal(stateAfterFlush.pendingQueueByConversation[conversationId].length, 0);
    assert.equal(messagePostCalls.length, 3);
    assert.notEqual(messagePostCalls[1].body.nonce, messagePostCalls[2].body.nonce);

    const feedAfterFlush = stateAfterFlush.messagesByConversation[conversationId];
    assert.deepEqual(
      feedAfterFlush.map((m) => m.status),
      ['sent', 'sent', 'sent']
    );

    // 6. Verify Bob on his NEW device (Device 2) decrypts both flushed messages without error
    const bobDevice2ConvId = `${conversationId}-bob-dev2`;
    await establishConversationKey(
      bobDevice2ConvId,
      bobDevice2.privateKey,
      aliceIdentity.publicKeyBase64,
      'alice-fp'
    );

    const decryptedMsg2 = await decryptMessage(
      bobDevice2ConvId,
      messagePostCalls[1].body.bodyCiphertext,
      messagePostCalls[1].body.nonce
    );
    const decryptedMsg3 = await decryptMessage(
      bobDevice2ConvId,
      messagePostCalls[2].body.bodyCiphertext,
      messagePostCalls[2].body.nonce
    );

    assert.equal(decryptedMsg2, 'Pesan kedua tertahan saat Bob ganti HP');
    assert.equal(decryptedMsg3, 'Pesan ketiga ikut antrean FIFO');

    // Verify Bob's OLD device (Device 1) CANNOT decrypt the re-encrypted messages
    await assert.rejects(() =>
      decryptMessage(
        bobDevice1ConvId,
        messagePostCalls[1].body.bodyCiphertext,
        messagePostCalls[1].body.nonce
      )
    );
  });

  test('conversationsStore.acceptPeerKeyChange automatically flushes queued messages and discardPendingMessages cancels held items', async () => {
    const conversationId = 'conv-device-change-2';
    const aliceId = 'user-alice-2';
    const bobId = 'user-bob-2';

    const aliceIdentity = await getOrCreateIdentityKeyPair(aliceId);
    const bobDevice1 = await generateKeyPair();
    const bobDevice2 = await generateKeyPair();
    let activeBobPub = await exportPublicKeyBase64(bobDevice1.publicKey);

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      const method = (options.method || 'GET').toUpperCase();

      if (urlStr.includes(`/api/users/${bobId}/identity-key`) && method === 'GET') {
        return new Response(
          JSON.stringify({ identityKey: { userId: bobId, publicKey: activeBobPub } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.endsWith(`/api/conversations/${conversationId}`) && method === 'GET') {
        return new Response(
          JSON.stringify({
            conversation: { id: conversationId, type: 'direct', peer: { id: bobId, username: 'bob' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.endsWith(`/api/conversations/${conversationId}/messages`) && method === 'POST') {
        const parsedBody = options.body ? JSON.parse(options.body) : {};
        messagePostCalls.push({ url: urlStr, method, body: parsedBody });
        return new Response(
          JSON.stringify({
            message: {
              id: `srv-auto-${messagePostCalls.length}`,
              conversationId,
              senderId: aliceId,
              bodyCiphertext: parsedBody.bodyCiphertext,
              nonce: parsedBody.nonce,
              clientMessageId: parsedBody.clientMessageId,
              createdAt: new Date().toISOString(),
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await establishConversationSession({
      conversationId,
      currentUserId: aliceId,
      peerUserId: bobId,
    });

    // Rotate Bob's key
    activeBobPub = await exportPublicKeyBase64(bobDevice2.publicKey);

    // Queue a message and then discard it
    const toDiscard = await messagesStore.sendMessage(conversationId, {
      plaintext: 'Pesan yang akan dibatalkan',
      senderId: aliceId,
      senderUsername: 'alice',
    });
    assert.equal(toDiscard.status, 'queued');
    assert.equal(get(messagesStore).pendingQueueByConversation[conversationId].length, 1);

    const discarded = messagesStore.discardPendingMessages(conversationId);
    assert.equal(discarded.length, 1);
    assert.equal(get(messagesStore).pendingQueueByConversation[conversationId].length, 0);
    assert.equal(get(messagesStore).messagesByConversation[conversationId].length, 0);
    assert.equal(messagePostCalls.length, 0);

    // Queue another message while keyChange is still pending, then accept via conversationsStore.acceptPeerKeyChange
    const queuedForAutoFlush = await messagesStore.sendMessage(conversationId, {
      plaintext: 'Pesan otomatis terkirim saat tombol Terima Kunci Baru diklik',
      senderId: aliceId,
      senderUsername: 'alice',
    });
    assert.equal(queuedForAutoFlush.status, 'queued');
    assert.equal(messagePostCalls.length, 0);

    // Accepting peer key change via store automatically re-establishes session and flushes queue
    const acceptRes = await conversationsStore.acceptPeerKeyChange(conversationId, aliceId, bobId);
    assert.equal(acceptRes.status, 'ready');
    assert.equal(messagePostCalls.length, 1);
    assert.equal(get(messagesStore).pendingQueueByConversation[conversationId].length, 0);

    const bobDev2Conv = `${conversationId}-bob2`;
    await establishConversationKey(
      bobDev2Conv,
      bobDevice2.privateKey,
      aliceIdentity.publicKeyBase64,
      'alice-fp'
    );
    assert.equal(
      await decryptMessage(
        bobDev2Conv,
        messagePostCalls[0].body.bodyCiphertext,
        messagePostCalls[0].body.nonce
      ),
      'Pesan otomatis terkirim saat tombol Terima Kunci Baru diklik'
    );
  });
});
