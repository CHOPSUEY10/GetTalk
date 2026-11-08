process.env.VITE_APP_ENV = process.env.VITE_APP_ENV || 'development';
process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
process.env.VITE_SOCKET_URL = process.env.VITE_SOCKET_URL || 'http://localhost:3000';

import 'fake-indexeddb/auto';
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compile } from 'svelte/compiler';
import { get } from 'svelte/store';

import {
  generateKeyPair,
  exportPublicKey,
  exportPublicKeyBase64,
} from '../src/services/crypto/ecdh.js';
import { toBase64Url } from '../src/services/crypto/aes-gcm.js';
import {
  getOrCreateIdentityKeyPair,
  clearCryptoState,
} from '../src/services/crypto/message-crypto.js';
import {
  deriveSafetyNumber,
  formatSafetyNumberBlocks,
  compareFingerprints,
  verifySafetyNumberQrPayload,
  generateQrCodeMatrix,
  generateQrCodeSvg,
  SAFETY_NUMBER_BLOCK_COUNT,
  SAFETY_NUMBER_BLOCK_SIZE,
  SAFETY_NUMBER_TOTAL_DIGITS,
} from '../src/services/crypto/safety-number.js';
import {
  storeTrustedFingerprint,
  storeVerificationStatus,
  getVerificationStatus,
} from '../src/services/crypto/key-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let getTrustedPeerKey;
let getPeerSafetyNumber;
let IdentityKeyChangedError;
let conversationsStore;
let messagesStore;

before(async () => {
  ({
    getTrustedPeerKey,
    getPeerSafetyNumber,
    IdentityKeyChangedError,
  } = await import('../src/services/crypto/identity-trust.js'));
  ({ conversationsStore } = await import('../src/stores/conversations.store.js'));
  ({ messagesStore } = await import('../src/stores/messages.store.js'));
});

describe('Safety Number Derivation, QR Code & Verification Status (Rule #17, NFR-15, AC-17)', () => {
  let originalFetch;
  let originalConsoleError;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalConsoleError = console.error;
    console.error = () => {};

    await clearCryptoState();
    conversationsStore.reset();
    messagesStore.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });

  test('derives a symmetric, deterministic 60-digit Safety Number (12 blocks x 5 digits) for both peers regardless of argument order', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const alicePubB64 = await exportPublicKeyBase64(alice.publicKey);
    const bobPubB64 = await exportPublicKeyBase64(bob.publicKey);

    // Alice computes Safety Number (Alice -> Bob)
    const fromAliceView = await deriveSafetyNumber(alicePubB64, bobPubB64, {
      userAId: 'user-alice',
      userBId: 'user-bob',
    });

    // Bob computes Safety Number (Bob -> Alice)
    const fromBobView = await deriveSafetyNumber(bobPubB64, alicePubB64, {
      userAId: 'user-bob',
      userBId: 'user-alice',
    });

    // Must be 60 numeric digits in 12 blocks of 5 digits
    assert.equal(fromAliceView.rawDigits.length, SAFETY_NUMBER_TOTAL_DIGITS);
    assert.match(fromAliceView.rawDigits, /^\d{60}$/);
    assert.equal(fromAliceView.blocks.length, SAFETY_NUMBER_BLOCK_COUNT);
    for (const block of fromAliceView.blocks) {
      assert.equal(block.length, SAFETY_NUMBER_BLOCK_SIZE);
      assert.match(block, /^\d{5}$/);
    }
    assert.equal(fromAliceView.formatted, fromAliceView.blocks.join(' '));

    // Must be 100% identical for both peers
    assert.equal(fromAliceView.rawDigits, fromBobView.rawDigits);
    assert.deepEqual(fromAliceView.blocks, fromBobView.blocks);
    assert.equal(fromAliceView.formatted, fromBobView.formatted);
    assert.equal(fromAliceView.combinedFingerprint, fromBobView.combinedFingerprint);
    assert.equal(fromAliceView.qrPayload, fromBobView.qrPayload);

    // Also produces the exact same result when passed CryptoKey objects directly
    const fromCryptoKeys = await deriveSafetyNumber(alice.publicKey, bob.publicKey, {
      userAId: 'user-alice',
      userBId: 'user-bob',
    });
    assert.equal(fromCryptoKeys.formatted, fromAliceView.formatted);
  });

  test('exhibits strong avalanche effect when a single bit of either public key changes', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const aliceRaw = new Uint8Array(await exportPublicKey(alice.publicKey));
    const bobRaw = new Uint8Array(await exportPublicKey(bob.publicKey));

    // Flip exactly 1 bit in Bob's public key
    const bobFlippedRaw = new Uint8Array(bobRaw);
    bobFlippedRaw[bobFlippedRaw.length - 1] ^= 0x01;

    const originalSafety = await deriveSafetyNumber(
      toBase64Url(aliceRaw.buffer),
      toBase64Url(bobRaw.buffer)
    );
    const modifiedSafety = await deriveSafetyNumber(
      toBase64Url(aliceRaw.buffer),
      toBase64Url(bobFlippedRaw.buffer)
    );

    assert.notEqual(originalSafety.rawDigits, modifiedSafety.rawDigits);
    assert.notEqual(originalSafety.formatted, modifiedSafety.formatted);
    assert.notEqual(originalSafety.qrPayload, modifiedSafety.qrPayload);

    // Count how many 5-digit blocks changed (with SHA-512 avalanche, almost all 12 blocks change)
    let changedBlocks = 0;
    for (let i = 0; i < SAFETY_NUMBER_BLOCK_COUNT; i++) {
      if (originalSafety.blocks[i] !== modifiedSafety.blocks[i]) {
        changedBlocks++;
      }
    }
    assert.ok(
      changedBlocks >= 9,
      `Expected strong avalanche across blocks, but only ${changedBlocks}/12 blocks changed`
    );

    // QR verification must reject the modified key's payload against original
    const verifyRes = verifySafetyNumberQrPayload(modifiedSafety.qrPayload, originalSafety);
    assert.equal(verifyRes.valid, false);
    assert.equal(verifyRes.reason, 'SAFETY_NUMBER_MISMATCH');
  });

  test('rejects private CryptoKey inputs and never exposes private keys in QR payload or SVG (Rule #8, #17, #34)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    await assert.rejects(
      () => deriveSafetyNumber(alice.privateKey, bob.publicKey),
      /Private or secret keys must never be used/i
    );

    const safety = await deriveSafetyNumber(alice.publicKey, bob.publicKey, {
      userAId: 'alice',
      userBId: 'bob',
    });

    // Generate QR SVG with fetch disabled to prove 0 external network calls
    let networkCalled = false;
    globalThis.fetch = async () => {
      networkCalled = true;
      throw new Error('External network call is forbidden during QR generation');
    };

    const matrix = generateQrCodeMatrix(safety.qrPayload);
    assert.ok(Array.isArray(matrix) && matrix.length >= 21);
    assert.equal(matrix.length, matrix[0].length);

    const svg = generateQrCodeSvg(safety.qrPayload);
    assert.equal(networkCalled, false);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('role="img"'));
    assert.ok(svg.includes('<path d="M'));
    assert.equal(svg.includes('privateKey'), false);

    // Verify QR payload matcher accepts both valid QR payload and formatted 60-digit string
    assert.equal(verifySafetyNumberQrPayload(safety.qrPayload, safety).valid, true);
    assert.equal(verifySafetyNumberQrPayload(safety.formatted, safety).valid, true);
    assert.equal(verifySafetyNumberQrPayload('12345', safety).valid, false);
    assert.deepEqual(formatSafetyNumberBlocks(safety.rawDigits), safety.blocks);
  });

  test('persists verification status in IndexedDB and automatically revokes verified status on peer device change (Rule #17, AC-17)', async () => {
    const conversationId = 'conv-verify-test-1';
    const aliceId = 'user-alice-verify';
    const bobId = 'user-bob-verify';

    await getOrCreateIdentityKeyPair(aliceId);
    const bobDevice1 = await generateKeyPair();
    const bobDevice2 = await generateKeyPair();

    let activeBobServerPublicKey = await exportPublicKeyBase64(bobDevice1.publicKey);

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      const method = (options.method || 'GET').toUpperCase();

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

      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // 1. Establish initial E2EE session (TOFU pins Bob's Device 1 key, initially unverified out-of-band)
    const initRes = await conversationsStore.initE2EESession(conversationId, aliceId);
    assert.equal(initRes.status, 'ready');
    assert.equal(get(conversationsStore).peerVerified, false);

    // 2. Load Safety Number for modal display
    const snInfo = await conversationsStore.loadSafetyNumber(conversationId, aliceId, bobId);
    assert.ok(snInfo);
    assert.equal(snInfo.blocks.length, 12);
    assert.equal(snInfo.verified, false);
    assert.ok(snInfo.qrSvg.startsWith('<svg'));

    // 3. Alice marks Bob as Verified ("Tandai sebagai Terverifikasi")
    const verifyRes = await conversationsStore.togglePeerVerification(conversationId, true, bobId);
    assert.equal(verifyRes.verified, true);
    assert.ok(verifyRes.verifiedAt);
    assert.equal(get(conversationsStore).peerVerified, true);
    assert.equal(get(conversationsStore).safetyNumber.verified, true);

    // 4. Verify persistence in IndexedDB (simulating page reload)
    const persisted = await getVerificationStatus(bobId);
    assert.equal(persisted.verified, true);
    assert.equal(persisted.fingerprint, snInfo.peerFingerprint);
    assert.ok(persisted.verifiedAt);

    // Re-initializing session with unchanged peer key preserves verified status
    await conversationsStore.initE2EESession(conversationId, aliceId);
    assert.equal(get(conversationsStore).peerVerified, true);

    // 5. Bob switches devices (new public key published on backend)
    activeBobServerPublicKey = await exportPublicKeyBase64(bobDevice2.publicKey);

    // Re-checking peer key detects IdentityKeyChangedError AND automatically revokes verified status!
    await assert.rejects(
      () => getTrustedPeerKey(bobId),
      (err) => err instanceof IdentityKeyChangedError
    );

    const afterRotationStatus = await getVerificationStatus(bobId);
    assert.equal(
      afterRotationStatus.verified,
      false,
      'Verified status in IndexedDB must automatically reset to false when peer public key changes'
    );
    assert.equal(afterRotationStatus.verifiedAt, null);

    // Store session init also reflects keyChange + unverified state
    const reinitRes = await conversationsStore.initE2EESession(conversationId, aliceId);
    assert.equal(reinitRes.status, 'keyChange');
    assert.equal(get(conversationsStore).peerVerified, false);

    // 6. Loading Safety Number during keyChange provides side-by-side fingerprint comparison
    const snDuringChange = await getPeerSafetyNumber(aliceId, bobId);
    assert.equal(snDuringChange.keyChanged, true);
    assert.equal(snDuringChange.verified, false);
    assert.ok(snDuringChange.fingerprintComparison);
    assert.equal(snDuringChange.fingerprintComparison.previousBlocks.length, 6);
    assert.equal(snDuringChange.fingerprintComparison.currentBlocks.length, 6);
    assert.ok(snDuringChange.fingerprintComparison.changedBlockIndices.length > 0);

    // 7. Approving the new key and marking verified from modal restores ready + verified state
    await conversationsStore.acceptPeerKeyChange(conversationId, aliceId, bobId, {
      verified: true,
    });
    assert.equal(get(conversationsStore).e2eeStatus, 'ready');
    assert.equal(get(conversationsStore).peerVerified, true);

    const finalPersisted = await getVerificationStatus(bobId);
    assert.equal(finalPersisted.verified, true);
    assert.equal(finalPersisted.fingerprint, snDuringChange.peerFingerprint);
  });

  test('SafetyNumberModal.svelte and Chat.svelte compile cleanly and implement accessible modal & responsive requirements (Rule #27, #28)', async () => {
    const modalPath = resolve(__dirname, '../src/components/chat/SafetyNumberModal.svelte');
    const chatPath = resolve(__dirname, '../src/pages/Chat.svelte');

    const [modalSource, chatSource] = await Promise.all([
      readFile(modalPath, 'utf8'),
      readFile(chatPath, 'utf8'),
    ]);

    const compiledModal = compile(modalSource, {
      filename: 'SafetyNumberModal.svelte',
      generate: 'client',
    });
    assert.ok(compiledModal.js?.code, 'SafetyNumberModal.svelte must compile without errors');

    const compiledChat = compile(chatSource, {
      filename: 'Chat.svelte',
      generate: 'client',
    });
    assert.ok(compiledChat.js?.code, 'Chat.svelte must compile without errors');

    // Verify accessibility & responsive attributes in SafetyNumberModal.svelte
    assert.ok(modalSource.includes('role="dialog"'), 'Modal must use semantic role="dialog"');
    assert.ok(modalSource.includes('aria-modal="true"'), 'Modal must specify aria-modal="true"');
    assert.ok(modalSource.includes('event.key === "Escape"'), 'Modal must close on Escape key');
    assert.ok(modalSource.includes('w-[228px] h-[228px]'), 'QR container must have fixed dimensions to prevent layout shift');
    assert.ok(modalSource.includes('Tandai sebagai Terverifikasi'), 'Modal must provide Mark as Verified action');
    assert.ok(chatSource.includes('E2EE Terverifikasi'), 'Chat header must display Verified Shield status when peer is verified');
    assert.ok(chatSource.includes('Bandingkan di Modal Safety Number'), 'Device change banner must allow comparing fingerprints in the modal');
  });
});

