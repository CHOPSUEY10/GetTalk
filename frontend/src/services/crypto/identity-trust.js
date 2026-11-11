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
import {
    storeTrustedFingerprint,
    getTrustedFingerprint,
    storeVerificationStatus,
    getVerificationStatus,
    revokeVerificationStatus,
} from './key-store.js';
import { toBase64Url, fromBase64Url } from './aes-gcm.js';
import {
    deriveSafetyNumber,
    formatSafetyNumberBlocks,
    formatFingerprintBlocks,
    compareFingerprints,
    buildSafetyNumberQrPayload,
    verifySafetyNumberQrPayload,
    generateQrCodeMatrix,
    generateQrCodeSvg,
} from './safety-number.js';
import {
    ENCRYPTION_ERROR_CODES,
    handleEncryptionError,
} from '../../lib/errors/encryptionerror.js';

export {
    deriveSafetyNumber,
    formatSafetyNumberBlocks,
    formatFingerprintBlocks,
    compareFingerprints,
    buildSafetyNumberQrPayload,
    verifySafetyNumberQrPayload,
    generateQrCodeMatrix,
    generateQrCodeSvg,
    storeVerificationStatus,
    getVerificationStatus,
    revokeVerificationStatus,
};

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
        // Automatically invalidate any prior out-of-band verification when the peer's public key changes (Rule #17, AC-17)
        await revokeVerificationStatus(userId);
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
 * Assert that a peer's current identity key matches the pinned fingerprint (Rule #17).
 * Throws IdentityKeyChangedError if the peer has rotated keys / changed devices.
 *
 * @param {string} userId
 * @returns {Promise<{ publicKey: string, fingerprint: string, trust: 'new' | 'trusted' }>}
 * @throws {IdentityKeyChangedError}
 */
export async function assertPeerIdentityKey(userId) {
    return getTrustedPeerKey(userId);
}

/**
 * Re-pin a changed key after the user verified the fingerprint out of band.
 *
 * @param {string} userId
 * @param {{ verified?: boolean }} [options]
 */
export async function acceptChangedPeerKey(userId, options = {}) {
    const identityKey = await fetchPeerIdentityKey(userId);
    await storeTrustedFingerprint(userId, identityKey.fingerprint);
    if (options?.verified) {
        await storeVerificationStatus(userId, {
            fingerprint: identityKey.fingerprint,
            verified: true,
        });
    }
    return {
        ...identityKey,
        trust: 'trusted',
        verified: Boolean(options?.verified),
    };
}

/**
 * Mark or unmark a peer's current identity key as verified out-of-band (Rule #17).
 *
 * @param {string} peerUserId
 * @param {boolean} verified
 * @param {string} [fingerprint]
 * @returns {Promise<{ userId: string, fingerprint: string | null, verified: boolean, verifiedAt: number | null, updatedAt: number }>}
 */
export async function setPeerVerificationStatus(peerUserId, verified, fingerprint) {
    let resolvedFp = fingerprint || (await getTrustedFingerprint(peerUserId));
    if (!resolvedFp) {
        const identityKey = await fetchPeerIdentityKey(peerUserId);
        resolvedFp = identityKey.fingerprint;
        await storeTrustedFingerprint(peerUserId, resolvedFp);
    }
    return storeVerificationStatus(peerUserId, {
        fingerprint: resolvedFp,
        verified: Boolean(verified),
    });
}

/**
 * Compute full Safety Number, QR Code SVG, fingerprint details, and verification state
 * between `currentUserId` and `peerUserId` (Rule #17, NFR-15, AC-17).
 *
 * @param {string} currentUserId
 * @param {string} peerUserId
 * @returns {Promise<{
 *   currentUserId: string,
 *   peerUserId: string,
 *   ownFingerprint: string,
 *   peerFingerprint: string,
 *   pinnedFingerprint: string | null,
 *   keyChanged: boolean,
 *   verified: boolean,
 *   verifiedAt: number | null,
 *   rawDigits: string,
 *   blocks: string[],
 *   formatted: string,
 *   combinedFingerprint: string,
 *   qrPayload: string,
 *   qrSvg: string,
 *   fingerprintComparison: ReturnType<typeof compareFingerprints> | null
 * }>}
 */
export async function getPeerSafetyNumber(currentUserId, peerUserId) {
    const ownIdentity = await getOrCreateIdentityKeyPair(currentUserId);
    const peerIdentity = await fetchPeerIdentityKey(peerUserId);
    const pinned = await getTrustedFingerprint(peerUserId);

    const keyChanged = Boolean(pinned && pinned !== peerIdentity.fingerprint);
    if (keyChanged) {
        await revokeVerificationStatus(peerUserId);
    } else if (!pinned) {
        await storeTrustedFingerprint(peerUserId, peerIdentity.fingerprint);
    }

    const verification = await getVerificationStatus(peerUserId);
    const isVerified = Boolean(
        !keyChanged &&
        verification.verified &&
        verification.fingerprint &&
        verification.fingerprint === peerIdentity.fingerprint
    );

    const safety = await deriveSafetyNumber(
        ownIdentity.publicKeyBase64,
        peerIdentity.publicKey,
        { userAId: currentUserId, userBId: peerUserId }
    );

    const qrSvg = generateQrCodeSvg(safety.qrPayload);
    const fingerprintComparison = keyChanged && pinned
        ? compareFingerprints(pinned, peerIdentity.fingerprint)
        : null;

    return {
        currentUserId,
        peerUserId,
        ownFingerprint: safety.fingerprintA,
        peerFingerprint: peerIdentity.fingerprint,
        pinnedFingerprint: pinned || peerIdentity.fingerprint,
        keyChanged,
        verified: isVerified,
        verifiedAt: isVerified ? verification.verifiedAt : null,
        rawDigits: safety.rawDigits,
        blocks: safety.blocks,
        formatted: safety.formatted,
        combinedFingerprint: safety.combinedFingerprint,
        qrPayload: safety.qrPayload,
        qrSvg,
        fingerprintComparison,
    };
}

/**
 * Compute the current device's own E2EE Identity Key Fingerprint & Safety Number summary.
 *
 * @param {string} userId
 * @returns {Promise<{
 *   userId: string,
 *   publicKey: string,
 *   fingerprint: string,
 *   fingerprintBlocks: string[],
 *   formattedFingerprint: string,
 *   safetyNumber: string,
 *   safetyNumberBlocks: string[]
 * }>}
 */
export async function getOwnIdentityFingerprint(userId) {
    const ownIdentity = await getOrCreateIdentityKeyPair(userId);
    const digest = await crypto.subtle.digest('SHA-256', fromBase64Url(ownIdentity.publicKeyBase64));
    const fingerprint = toBase64Url(digest);
    const fingerprintBlocks = formatFingerprintBlocks(fingerprint);
    const safety = await deriveSafetyNumber(
        ownIdentity.publicKeyBase64,
        ownIdentity.publicKeyBase64,
        { userAId: userId, userBId: userId }
    );

    return {
        userId,
        publicKey: ownIdentity.publicKeyBase64,
        fingerprint,
        fingerprintBlocks,
        formattedFingerprint: fingerprintBlocks.join(' '),
        safetyNumber: safety.formatted,
        safetyNumberBlocks: safety.blocks,
    };
}

// ── Local App Passcode Lock (Client-Side Key Protection) ──────────────────────

const appLockMemoryStore = new Map();

function getAppLockStorageKey(userId) {
    return `gettalk_app_lock_${userId || 'default'}`;
}

function readAppLockRecord(userId) {
    const key = getAppLockStorageKey(userId);
    if (appLockMemoryStore.has(key)) {
        return appLockMemoryStore.get(key);
    }
    try {
        if (typeof globalThis.localStorage !== 'undefined') {
            const raw = globalThis.localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                appLockMemoryStore.set(key, parsed);
                return parsed;
            }
        }
    } catch {
        // Fallback to memory store
    }
    return null;
}

function writeAppLockRecord(userId, record) {
    const key = getAppLockStorageKey(userId);
    if (record === null) {
        appLockMemoryStore.delete(key);
        try {
            if (typeof globalThis.localStorage !== 'undefined') {
                globalThis.localStorage.removeItem(key);
            }
        } catch {
            // Ignore storage errors
        }
        return;
    }
    appLockMemoryStore.set(key, record);
    try {
        if (typeof globalThis.localStorage !== 'undefined') {
            globalThis.localStorage.setItem(key, JSON.stringify(record));
        }
    } catch {
        // Ignore storage errors
    }
}

async function hashPasscodeWithSalt(passcode, saltBase64) {
    const encoder = new TextEncoder();
    const data = encoder.encode(`gettalk-app-lock:v1:${saltBase64}:${String(passcode).trim()}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return toBase64Url(digest);
}

/**
 * Retrieve local App Passcode Lock configuration for a user.
 * @param {string} userId
 */
export function getAppLockConfig(userId) {
    const record = readAppLockRecord(userId);
    if (!record || !record.enabled || !record.hash) {
        return {
            enabled: false,
            autoLockMinutes: 5,
            updatedAt: null,
        };
    }
    return {
        enabled: true,
        autoLockMinutes: record.autoLockMinutes || 5,
        updatedAt: record.updatedAt || null,
    };
}

/**
 * Configure a local App Passcode Lock PIN using Web Crypto SHA-256 + salt.
 * Never stores the raw PIN.
 *
 * @param {string} userId
 * @param {string} passcode
 * @param {number} [autoLockMinutes=5]
 */
export async function setAppPasscode(userId, passcode, autoLockMinutes = 5) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = toBase64Url(saltBytes.buffer);
    const hash = await hashPasscodeWithSalt(passcode, salt);
    const record = {
        enabled: true,
        salt,
        hash,
        autoLockMinutes: Number(autoLockMinutes) || 5,
        updatedAt: Date.now(),
    };
    writeAppLockRecord(userId, record);
    return {
        enabled: true,
        autoLockMinutes: record.autoLockMinutes,
        updatedAt: record.updatedAt,
    };
}

/**
 * Verify a candidate PIN against the stored salted hash.
 * @param {string} userId
 * @param {string} passcode
 * @returns {Promise<boolean>}
 */
export async function verifyAppPasscode(userId, passcode) {
    const record = readAppLockRecord(userId);
    if (!record || !record.enabled || !record.salt || !record.hash) {
        return true;
    }
    const candidateHash = await hashPasscodeWithSalt(passcode, record.salt);
    return candidateHash === record.hash;
}

/**
 * Disable the local App Passcode Lock after verifying the current PIN.
 * @param {string} userId
 * @param {string} passcode
 * @returns {Promise<boolean>}
 */
export async function disableAppPasscode(userId, passcode) {
    const valid = await verifyAppPasscode(userId, passcode);
    if (!valid) {
        return false;
    }
    writeAppLockRecord(userId, null);
    return true;
}
