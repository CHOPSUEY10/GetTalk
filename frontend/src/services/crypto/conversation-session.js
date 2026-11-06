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

import {
  getOrCreateIdentityKeyPair,
  establishConversationKey,
  onClearCryptoState,
} from './message-crypto.js';
import { getTrustedPeerKey, IdentityKeyChangedError } from './identity-trust.js';
import {
  ENCRYPTION_ERROR_CODES,
  EncryptionError,
  handleEncryptionError,
} from '../../lib/errors/encryptionerror.js';

/**
 * Tracked participant context per conversation so outgoing messages can
 * verify peer key continuity (Rule #17) and re-establish sessions after
 * out-of-band key approval.
 * @type {Map<string, { currentUserId: string, peerUserId: string }>}
 */
const conversationPeers = new Map();

onClearCryptoState(() => {
  conversationPeers.clear();
});

/**
 * Get the tracked currentUserId and peerUserId for a conversation, if known.
 * @param {string} conversationId
 * @returns {{ currentUserId: string, peerUserId: string } | null}
 */
export function getConversationSessionPeer(conversationId) {
  return conversationPeers.get(conversationId) || null;
}

/**
 * Register or update the participant context for a conversation.
 * @param {string} conversationId
 * @param {{ currentUserId: string, peerUserId: string }} peers
 */
export function setConversationSessionPeer(conversationId, peers) {
  if (conversationId && peers?.currentUserId && peers?.peerUserId) {
    conversationPeers.set(conversationId, {
      currentUserId: peers.currentUserId,
      peerUserId: peers.peerUserId,
    });
  }
}

/**
 * Clear tracked conversation peers (e.g. on logout / test reset).
 */
export function clearConversationSessionPeers() {
  conversationPeers.clear();
}

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

  conversationPeers.set(conversationId, { currentUserId, peerUserId });

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
