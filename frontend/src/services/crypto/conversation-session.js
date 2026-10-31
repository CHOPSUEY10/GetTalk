/**
 * Conversation E2EE session setup (issues #10, #12).
 *
 * Flow:
 *   1. Load/create this browser's identity key pair (private key stays local).
 *   2. Fetch the peer key from the registry and enforce TOFU pinning.
 *   3. ECDH + HKDF → per-conversation AES-256-GCM key.
 *
 * Any failure (missing peer key, changed fingerprint, Redis outage) throws;
 * callers must refuse to send rather than fall back to a weaker key.
 */

import { getOrCreateIdentityKeyPair, establishConversationKey } from './message-crypto.js';
import { getTrustedPeerKey, IdentityKeyChangedError } from './identity-trust.js';
import {
  ENCRYPTION_ERROR_CODES,
  EncryptionError,
  handleEncryptionError,
} from '../../errors/encryptionerror.js';

/**
 * @param {{ conversationId: string, currentUserId: string, peerUserId: string }} params
 * @returns {Promise<CryptoKey>}
 */
export async function establishConversationSession({ conversationId, currentUserId, peerUserId }) {
  if (!conversationId || !currentUserId || !peerUserId) {
    throw handleEncryptionError(
      new Error('Conversation, current user and peer are required to establish E2EE.'),
      {
        code: ENCRYPTION_ERROR_CODES.KEY_EXCHANGE_FAILED,
        operation: 'session-setup',
        conversationId,
      }
    );
  }

  try {
    const { privateKey } = await getOrCreateIdentityKeyPair(currentUserId);
    const peerKey = await getTrustedPeerKey(peerUserId);

    return await establishConversationKey(
      conversationId,
      privateKey,
      peerKey.publicKey,
      peerKey.fingerprint
    );
  } catch (err) {
    if (err instanceof IdentityKeyChangedError || err instanceof EncryptionError) {
      throw err;
    }
    const anyErr = /** @type {any} */ (err);
    const resolvedCode =
      anyErr?.code === ENCRYPTION_ERROR_CODES.IDENTITY_KEY_NOT_FOUND ||
      anyErr?.code === ENCRYPTION_ERROR_CODES.KEY_REGISTRY_UNAVAILABLE ||
      anyErr?.code === ENCRYPTION_ERROR_CODES.INVALID_PUBLIC_KEY
        ? anyErr.code
        : ENCRYPTION_ERROR_CODES.KEY_EXCHANGE_FAILED;

    throw handleEncryptionError(anyErr, {
      code: resolvedCode,
      operation: 'session-setup',
      conversationId,
    });
  }
}
