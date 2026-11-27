import { Preferences } from '@capacitor/preferences';
import {
  BackendDocument,
  BackendJob,
  LocalProcessingHistoryItem,
  UserEntitlements,
  UserUsageMetrics,
} from '../types';
import { secureStorage } from './secureStorage';

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const KEY_PREFIX = 'omnidoc_u_';
const CACHE_KEY_SECRET_PREFIX = 'omnidoc_offline_aes_key_';

let activeUserId = 'default';
const memoryStore = new Map<string, string>();

function hashNamespace(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= input.charCodeAt(i) + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function userKey(suffix: string, userId = activeUserId): string {
  return `${KEY_PREFIX}${hashNamespace(userId)}_${suffix}`;
}

function getCacheKeySecretName(userId = activeUserId): string {
  return `${CACHE_KEY_SECRET_PREFIX}${hashNamespace(userId)}`;
}

async function prefSet(key: string, value: string): Promise<void> {
  memoryStore.set(key, value);
  try {
    await Preferences.set({ key, value });
  } catch {
    // ignore in unit tests
  }
}

async function prefGet(key: string): Promise<string | null> {
  if (memoryStore.has(key)) return memoryStore.get(key) ?? null;
  try {
    const res = await Preferences.get({ key });
    if (res.value) {
      memoryStore.set(key, res.value);
      return res.value;
    }
  } catch {
    // ignore
  }
  return null;
}

async function prefRemove(key: string): Promise<void> {
  memoryStore.delete(key);
  try {
    await Preferences.remove({ key });
  } catch {
    // ignore
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function hasSubtleCrypto(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined' && typeof crypto.getRandomValues === 'function';
}

async function getOrCreateUserAesKey(userId = activeUserId): Promise<CryptoKey | null> {
  if (!hasSubtleCrypto()) return null;
  const secretKeyName = getCacheKeySecretName(userId);
  let rawKeyB64 = await secureStorage.getAuxiliarySecret(secretKeyName);

  if (rawKeyB64) {
    try {
      const keyBytes = base64ToUint8(rawKeyB64);
      if (keyBytes.length === 32) {
        return await crypto.subtle.importKey(
          'raw',
          keyBytes as BufferSource,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      }
    } catch {
      // Regenerate clean key if wrapped secret was corrupted
    }
  }

  const raw = crypto.getRandomValues(new Uint8Array(32));
  rawKeyB64 = uint8ToBase64(raw);
  await secureStorage.setAuxiliarySecret(secretKeyName, rawKeyB64);
  return await crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

interface EncryptedEnvelope {
  v: 1;
  uid: string;
  createdAt: number;
  expiresAt: number;
  iv?: string;
  ct: string;
  plain?: boolean;
}

async function setEncryptedRecord(
  suffix: string,
  payload: unknown,
  ttlMs = DEFAULT_CACHE_TTL_MS
): Promise<void> {
  const uid = hashNamespace(activeUserId);
  const keyName = userKey(suffix);
  const now = Date.now();
  const expiresAt = now + Math.max(1, ttlMs);
  const plaintext = JSON.stringify(payload);

  const aesKey = await getOrCreateUserAesKey(activeUserId);
  if (!aesKey) {
    // Fallback envelope if subtle crypto is absent in an atypical environment
    const env: EncryptedEnvelope = {
      v: 1,
      uid,
      createdAt: now,
      expiresAt,
      plain: true,
      ct: plaintext,
    };
    await prefSet(keyName, JSON.stringify(env));
    return;
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aesKey,
    encoded as BufferSource
  );

  const env: EncryptedEnvelope = {
    v: 1,
    uid,
    createdAt: now,
    expiresAt,
    iv: uint8ToBase64(iv),
    ct: uint8ToBase64(new Uint8Array(encrypted)),
  };
  await prefSet(keyName, JSON.stringify(env));
}

async function getDecryptedRecord<T>(suffix: string): Promise<T | null> {
  const keyName = userKey(suffix);
  const raw = await prefGet(keyName);
  if (!raw) return null;

  try {
    const env = JSON.parse(raw) as EncryptedEnvelope;
    const expectedUid = hashNamespace(activeUserId);
    if (!env || env.v !== 1 || env.uid !== expectedUid) {
      await prefRemove(keyName);
      return null;
    }
    if (typeof env.expiresAt !== 'number' || Date.now() > env.expiresAt) {
      await prefRemove(keyName);
      return null;
    }

    if (env.plain) {
      return JSON.parse(env.ct) as T;
    }

    if (!env.iv || !env.ct) {
      await prefRemove(keyName);
      return null;
    }
    const aesKey = await getOrCreateUserAesKey(activeUserId);
    if (!aesKey) {
      await prefRemove(keyName);
      return null;
    }

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToUint8(env.iv) as BufferSource },
      aesKey,
      base64ToUint8(env.ct) as BufferSource
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  } catch {
    // Decryption failure or tampered payload -> purge cleanly & fail closed
    await prefRemove(keyName);
    return null;
  }
}

function minimizeDocumentForCache(doc: BackendDocument): BackendDocument {
  if (!doc.digital_twin || typeof doc.digital_twin !== 'object') {
    return doc;
  }
  const cleanTwin: Record<string, any> = { ...doc.digital_twin };
  delete cleanTwin.extracted_text_preview;
  delete cleanTwin.text_preview;
  delete cleanTwin.content_preview;
  return {
    ...doc,
    digital_twin: cleanTwin,
  };
}

export const offlineStore = {
  setActiveUser(userId: string | null): void {
    activeUserId = userId && userId.trim() ? userId.trim() : 'default';
  },

  getActiveUser(): string {
    return activeUserId;
  },

  // Non-sensitive UI preference (explicitly stored unencrypted per data classification policy)
  async setPreference(key: string, value: string): Promise<void> {
    await prefSet(`omnidoc_pref_${key}`, value);
  },

  async getPreference(key: string): Promise<string | null> {
    return prefGet(`omnidoc_pref_${key}`);
  },

  async cacheDocuments(docs: BackendDocument[], ttlMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
    const minimized = docs.slice(0, 100).map(minimizeDocumentForCache);
    await setEncryptedRecord('docs', minimized, ttlMs);
    await prefSet(userKey('last_sync'), String(Date.now()));
  },

  async getCachedDocuments(): Promise<BackendDocument[]> {
    return (await getDecryptedRecord<BackendDocument[]>('docs')) || [];
  },

  async cacheJobs(jobs: BackendJob[], ttlMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
    await setEncryptedRecord('jobs', jobs.slice(0, 100), ttlMs);
  },

  async getCachedJobs(): Promise<BackendJob[]> {
    return (await getDecryptedRecord<BackendJob[]>('jobs')) || [];
  },

  async cacheUsage(usage: UserUsageMetrics, ttlMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
    await setEncryptedRecord('usage', usage, ttlMs);
  },

  async getCachedUsage(): Promise<UserUsageMetrics | null> {
    return getDecryptedRecord<UserUsageMetrics>('usage');
  },

  async cacheEntitlements(entitlements: UserEntitlements, ttlMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
    await setEncryptedRecord('entitlements', entitlements, ttlMs);
  },

  async getCachedEntitlements(): Promise<UserEntitlements | null> {
    return getDecryptedRecord<UserEntitlements>('entitlements');
  },

  async appendHistory(entry: Omit<LocalProcessingHistoryItem, 'id' | 'createdAt'>): Promise<LocalProcessingHistoryItem> {
    const existing = await this.getLocalHistory();
    const created: LocalProcessingHistoryItem = {
      ...entry,
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    const next = [created, ...existing].slice(0, 150);
    await setEncryptedRecord('history', next, DEFAULT_CACHE_TTL_MS * 7);
    return created;
  },

  async getLocalHistory(): Promise<LocalProcessingHistoryItem[]> {
    return (await getDecryptedRecord<LocalProcessingHistoryItem[]>('history')) || [];
  },

  async clearLocalHistory(): Promise<void> {
    await prefRemove(userKey('history'));
  },

  async getLastSyncTimestamp(): Promise<number | null> {
    const raw = await prefGet(userKey('last_sync'));
    return raw ? Number(raw) : null;
  },

  async clearUserCaches(userId = activeUserId): Promise<void> {
    await Promise.all([
      prefRemove(userKey('docs', userId)),
      prefRemove(userKey('jobs', userId)),
      prefRemove(userKey('usage', userId)),
      prefRemove(userKey('entitlements', userId)),
      prefRemove(userKey('history', userId)),
      prefRemove(userKey('last_sync', userId)),
      secureStorage.removeAuxiliarySecret(getCacheKeySecretName(userId)),
    ]);
  },
};
