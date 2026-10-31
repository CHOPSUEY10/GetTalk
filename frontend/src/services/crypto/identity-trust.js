/**
 * Peer identity key trust (TOFU + fingerprint pinning, issue #11).
 *
 * The server/Redis is treated as an untrusted key directory:
 *  - the fingerprint is always recomputed locally from the returned key,
 *    never taken from the server response;
 *  - the first key seen for a user is pinned in IndexedDB;
 *  - any later key change raises IdentityKeyChangedError until the user
 *    verifies the new fingerprint out of band and accepts it.
 *
 * Private keys never leave the browser: only publicKey is published.
 */

import { getOrCreateIdentityKeyPair } from './message-crypto.js';
import { publishIdentityKey, fetchIdentityKey } from '../api/identity-keys.api.js';
import { storeTrustedFingerprint, getTrustedFingerprint } from './key-store.js';
import { toBase64Url, fromBase64Url } from './aes-gcm.js';
import {
  ENCRYPTION_ERROR_CODES,
  handleEncryptionError,
} from '../../errors/encryptionerror.js';

export class IdentityKeyChangedError extends Error {
  /**
   * @param {string} userId
   * @param {string} previousFingerprint
   * @param {string} fingerprint
   */
  constructor(userId, previousFingerprint, fingerprint) {
    super(
      `Identity key for ${userId} changed. Verify the new fingerprint before continuing.`
    );
    this.name = 'IdentityKeyChangedError';
    this.code = ENCRYPTION_ERROR_CODES.IDENTITY_KEY_CHANGED;
    this.category = ENCRYPTION_ERROR_CODES.IDENTITY_KEY_CHANGED;
    this.source = 'encryption';
    this.userId = userId;
    this.previousFingerprint = previousFingerprint;
    this.fingerprint = fingerprint;
    this.logged = false;
  }
}

/**
 * Publish this browser's identity public key for the authenticated user.
 * Safe to call on every login/session restore (idempotent).
 *
 * @param {string} userId
 */
export async function publishOwnIdentityKey(userId) {
  const { publicKeyBase64 } = await getOrCreateIdentityKeyPair(userId);
  return publishIdentityKey(publicKeyBase64);
}

/**
 * @param {string} userId
 * @returns {Promise<{ publicKey: string, fingerprint: string, updatedAt?: string }>}
 */
async function fetchPeerIdentityKey(userId) {
  const response = await fetchIdentityKey(userId);
  const identityKey = response?.identityKey || response;

  if (!identityKey?.publicKey) {
    throw handleEncryptionError(
      new Error('Identity key response is missing publicKey'),
      {
        code: ENCRYPTION_ERROR_CODES.KEY_UNAVAILABLE,
        operation: 'identity-verify',
      }
    );
  }

  // Recompute locally: the server-provided fingerprint is not trusted.
  const digest = await crypto.subtle.digest('SHA-256', fromBase64Url(identityKey.publicKey));
  return { ...identityKey, fingerprint: toBase64Url(digest) };
}

/**
 * Fetch a peer's key and enforce TOFU pinning.
 *
 * @param {string} userId
 * @returns {Promise<{ publicKey: string, fingerprint: string, trust: 'new' | 'trusted' }>}
 * @throws {IdentityKeyChangedError} when the key differs from the pinned one
 */
export async function getTrustedPeerKey(userId) {
  const identityKey = await fetchPeerIdentityKey(userId);
  const pinned = await getTrustedFingerprint(userId);

  if (!pinned) {
    await storeTrustedFingerprint(userId, identityKey.fingerprint);
    return { ...identityKey, trust: 'new' };
  }

  if (pinned !== identityKey.fingerprint) {
    const changedErr = new IdentityKeyChangedError(userId, pinned, identityKey.fingerprint);
    handleEncryptionError(changedErr, {
      code: ENCRYPTION_ERROR_CODES.IDENTITY_KEY_CHANGED,
      operation: 'identity-verify',
    });
    changedErr.logged = true;
    throw changedErr;
  }

  return { ...identityKey, trust: 'trusted' };
}

/**
 * Re-pin a changed key after the user verified the fingerprint out of band.
 *
 * @param {string} userId
 */
export async function acceptChangedPeerKey(userId) {
  const identityKey = await fetchPeerIdentityKey(userId);
  await storeTrustedFingerprint(userId, identityKey.fingerprint);
  return { ...identityKey, trust: 'trusted' };
}
