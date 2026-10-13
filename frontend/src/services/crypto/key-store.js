/**
 * IndexedDB-backed key store for non-extractable ECDH private keys.
 * (Issue #5 — E2EE crypto layer)
 *
 * Uses a single IndexedDB database "gettalk-keystore" with an object store
 * "keys" keyed by a composite string (userId or conversationId).
 *
 * CryptoKey objects stored here remain non-extractable — IndexedDB supports
 * structured-clone of CryptoKey, preserving the non-extractable property.
 */

const DB_NAME = 'gettalk-keystore';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store a key pair associated with an identifier.
 *
 * @param {string} id - Unique identifier (e.g., `user:<userId>` or `conv:<convId>`)
 * @param {CryptoKeyPair} keyPair - ECDH key pair to store
 * @returns {Promise<void>}
 */
export async function storeKeyPair(id, keyPair) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({
      id,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      createdAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve a stored key pair by identifier.
 *
 * @param {string} id
 * @returns {Promise<{ privateKey: CryptoKey, publicKey: CryptoKey, createdAt: number } | null>}
 */
export async function getKeyPair(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      const result = request.result;
      if (result) {
        resolve({
          privateKey: result.privateKey,
          publicKey: result.publicKey,
          createdAt: result.createdAt,
        });
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store a derived symmetric key (AES-256-GCM) for a conversation.
 *
 * @param {string} id - Unique identifier (e.g., `derived:<convId>`)
 * @param {CryptoKey} derivedKey - AES-256-GCM key
 * @returns {Promise<void>}
 */
export async function storeDerivedKey(id, derivedKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({
      id,
      derivedKey,
      createdAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve a stored derived key by identifier.
 *
 * @param {string} id
 * @returns {Promise<CryptoKey | null>}
 */
export async function getDerivedKey(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      resolve(request.result?.derivedKey || null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a key entry by identifier.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteKey(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Clear all keys from the store (e.g., on logout).
 *
 * @returns {Promise<void>}
 */
export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
