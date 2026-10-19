import 'fake-indexeddb/auto';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { generateKeyPair, exportPublicKeyBase64 } from '../src/services/crypto/ecdh.js';
import {
  establishConversationKey,
  encryptMessage,
  decryptMessage,
  clearCryptoState,
} from '../src/services/crypto/message-crypto.js';
import { fromBase64Url, toBase64Url } from '../src/services/crypto/aes-gcm.js';
import { encryptFile, decryptFile } from '../src/services/crypto/file-crypto.js';

let counter = 0;
const nextConversation = () => `test-conv-${Date.now()}-${counter++}`;

beforeEach(async () => {
  await clearCryptoState();
});

describe('E2EE message crypto (issues #10, #12)', () => {
  test('two peers derive a compatible key and decrypt each other', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const conversationId = nextConversation();

    // Alice's browser.
    await establishConversationKey(
      conversationId,
      alice.privateKey,
      await exportPublicKeyBase64(bob.publicKey),
      'bob-fingerprint'
    );
    const encrypted = await encryptMessage(conversationId, 'halo rahasia');

    // Bob's browser (separate derivation from the same shared secret).
    await establishConversationKey(
      conversationId,
      bob.privateKey,
      await exportPublicKeyBase64(alice.publicKey),
      'alice-fingerprint'
    );

    assert.equal(
      await decryptMessage(conversationId, encrypted.bodyCiphertext, encrypted.nonce),
      'halo rahasia'
    );
  });

  test('refuses to encrypt before a key is established (no fallback)', async () => {
    await assert.rejects(
      encryptMessage(nextConversation(), 'plaintext must not leak'),
      /No encryption key established/
    );
  });

  test('refuses to establish a key without peer key and fingerprint', async () => {
    const alice = await generateKeyPair();

    await assert.rejects(
      establishConversationKey(nextConversation(), alice.privateKey, '', ''),
      /peer public key and fingerprint/i
    );
  });

  test('rejects tampered ciphertext (AES-GCM authentication)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const conversationId = nextConversation();

    await establishConversationKey(
      conversationId,
      alice.privateKey,
      await exportPublicKeyBase64(bob.publicKey),
      'bob-fingerprint'
    );
    const encrypted = await encryptMessage(conversationId, 'integrity');

    const bytes = new Uint8Array(fromBase64Url(encrypted.bodyCiphertext));
    bytes[0] ^= 0xff;

    await assert.rejects(
      decryptMessage(conversationId, toBase64Url(bytes.buffer), encrypted.nonce)
    );
  });

  test('a rotated peer key never reuses the old conversation key', async () => {
    const alice = await generateKeyPair();
    const bobOld = await generateKeyPair();
    const bobNew = await generateKeyPair();
    const conversationId = nextConversation();

    await establishConversationKey(
      conversationId,
      alice.privateKey,
      await exportPublicKeyBase64(bobOld.publicKey),
      'bob-old'
    );
    const oldMessage = await encryptMessage(conversationId, 'old key message');

    // Key rotation (different fingerprint) must select a different derived key.
    await establishConversationKey(
      conversationId,
      alice.privateKey,
      await exportPublicKeyBase64(bobNew.publicKey),
      'bob-new'
    );

    await assert.rejects(
      decryptMessage(conversationId, oldMessage.bodyCiphertext, oldMessage.nonce)
    );

    const fresh = await encryptMessage(conversationId, 'new key message');
    assert.equal(
      await decryptMessage(conversationId, fresh.bodyCiphertext, fresh.nonce),
      'new key message'
    );
  });

  test('AES-GCM rejects a wrong nonce', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const conversationId = nextConversation();

    await establishConversationKey(
      conversationId,
      alice.privateKey,
      await exportPublicKeyBase64(bob.publicKey),
      'bob-fingerprint'
    );
    const encrypted = await encryptMessage(conversationId, 'nonce check');
    const wrongNonce = toBase64Url(crypto.getRandomValues(new Uint8Array(12)).buffer);

    await assert.rejects(
      decryptMessage(conversationId, encrypted.bodyCiphertext, wrongNonce)
    );
  });
});

describe('Attachment encryption and metadata privacy (issue #15)', () => {
  async function establishTestSession(conversationId) {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    await establishConversationKey(
      conversationId,
      alice.privateKey,
      await exportPublicKeyBase64(bob.publicKey),
      'bob-fingerprint'
    );
  }

  test('encrypts file content and metadata; only the key holder recovers them', async () => {
    const conversationId = nextConversation();
    await establishTestSession(conversationId);

    const file = new File(
      [new TextEncoder().encode('isi rahasia')],
      'rahasia.txt',
      { type: 'text/plain' }
    );

    const encrypted = await encryptFile(file, conversationId);

    // Nothing sent to the server may contain the plaintext metadata.
    const wire = JSON.stringify(encrypted);
    assert.equal(wire.includes('rahasia.txt'), false);
    assert.equal(wire.includes('text/plain'), false);

    const decrypted = await decryptFile(
      await encrypted.encryptedBlob.arrayBuffer(),
      encrypted.fileNonce,
      encrypted.encryptedFileKey,
      encrypted.keyNonce,
      conversationId,
      encrypted.metadataCiphertext,
      encrypted.metadataNonce
    );

    assert.equal(decrypted.name, 'rahasia.txt');
    assert.equal(decrypted.type, 'text/plain');
    assert.equal(decrypted.size, file.size);
    assert.equal(await decrypted.blob.text(), 'isi rahasia');
  });

  test('rejects tampered metadata', async () => {
    const conversationId = nextConversation();
    await establishTestSession(conversationId);

    const file = new File([new TextEncoder().encode('x')], 'a.txt', { type: 'text/plain' });
    const encrypted = await encryptFile(file, conversationId);

    const metadataBytes = new Uint8Array(fromBase64Url(encrypted.metadataCiphertext));
    metadataBytes[0] ^= 0xff;

    await assert.rejects(
      decryptFile(
        await encrypted.encryptedBlob.arrayBuffer(),
        encrypted.fileNonce,
        encrypted.encryptedFileKey,
        encrypted.keyNonce,
        conversationId,
        toBase64Url(metadataBytes.buffer),
        encrypted.metadataNonce
      )
    );
  });
});
