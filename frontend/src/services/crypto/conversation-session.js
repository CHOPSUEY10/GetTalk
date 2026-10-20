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
import { getTrustedPeerKey } from './identity-trust.js';

/**
 * @param {{ conversationId: string, currentUserId: string, peerUserId: string }} params
 * @returns {Promise<CryptoKey>}
 */
export async function establishConversationSession({ conversationId, currentUserId, peerUserId }) {
  if (!conversationId || !currentUserId || !peerUserId) {
    throw new Error('Conversation, current user and peer are required to establish E2EE.');
  }

  const { privateKey } = await getOrCreateIdentityKeyPair(currentUserId);
  const peerKey = await getTrustedPeerKey(peerUserId);

  return establishConversationKey(
    conversationId,
    privateKey,
    peerKey.publicKey,
    peerKey.fingerprint
  );
}
