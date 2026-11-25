import { Preferences } from '@capacitor/preferences';
import { BackendDocument, BackendJob, LocalProcessingHistoryItem, UserEntitlements, UserUsageMetrics } from '../types';

const DOCS_CACHE_KEY = 'omnidoc_cache_docs_v1';
const JOBS_CACHE_KEY = 'omnidoc_cache_jobs_v1';
const USAGE_CACHE_KEY = 'omnidoc_cache_usage_v1';
const ENTITLEMENTS_CACHE_KEY = 'omnidoc_cache_entitlements_v1';
const LOCAL_HISTORY_KEY = 'omnidoc_local_history_v1';
const LAST_SYNC_KEY = 'omnidoc_last_sync_ts_v1';

const memoryStore = new Map<string, string>();

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

export const offlineStore = {
  async cacheDocuments(docs: BackendDocument[]): Promise<void> {
    await prefSet(DOCS_CACHE_KEY, JSON.stringify(docs.slice(0, 100)));
    await prefSet(LAST_SYNC_KEY, String(Date.now()));
  },

  async getCachedDocuments(): Promise<BackendDocument[]> {
    const raw = await prefGet(DOCS_CACHE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as BackendDocument[];
    } catch {
      return [];
    }
  },

  async cacheJobs(jobs: BackendJob[]): Promise<void> {
    await prefSet(JOBS_CACHE_KEY, JSON.stringify(jobs.slice(0, 100)));
  },

  async getCachedJobs(): Promise<BackendJob[]> {
    const raw = await prefGet(JOBS_CACHE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as BackendJob[];
    } catch {
      return [];
    }
  },

  async cacheUsage(usage: UserUsageMetrics): Promise<void> {
    await prefSet(USAGE_CACHE_KEY, JSON.stringify(usage));
  },

  async getCachedUsage(): Promise<UserUsageMetrics | null> {
    const raw = await prefGet(USAGE_CACHE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserUsageMetrics;
    } catch {
      return null;
    }
  },

  async cacheEntitlements(entitlements: UserEntitlements): Promise<void> {
    await prefSet(ENTITLEMENTS_CACHE_KEY, JSON.stringify(entitlements));
  },

  async getCachedEntitlements(): Promise<UserEntitlements | null> {
    const raw = await prefGet(ENTITLEMENTS_CACHE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserEntitlements;
    } catch {
      return null;
    }
  },

  async appendHistory(entry: Omit<LocalProcessingHistoryItem, 'id' | 'createdAt'>): Promise<LocalProcessingHistoryItem> {
    const existing = await this.getLocalHistory();
    const created: LocalProcessingHistoryItem = {
      ...entry,
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    const next = [created, ...existing].slice(0, 150);
    await prefSet(LOCAL_HISTORY_KEY, JSON.stringify(next));
    return created;
  },

  async getLocalHistory(): Promise<LocalProcessingHistoryItem[]> {
    const raw = await prefGet(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as LocalProcessingHistoryItem[];
    } catch {
      return [];
    }
  },

  async clearLocalHistory(): Promise<void> {
    await prefRemove(LOCAL_HISTORY_KEY);
  },

  async getLastSyncTimestamp(): Promise<number | null> {
    const raw = await prefGet(LAST_SYNC_KEY);
    return raw ? Number(raw) : null;
  },

  async clearUserCaches(): Promise<void> {
    await Promise.all([
      prefRemove(DOCS_CACHE_KEY),
      prefRemove(JOBS_CACHE_KEY),
      prefRemove(USAGE_CACHE_KEY),
      prefRemove(ENTITLEMENTS_CACHE_KEY),
      prefRemove(LOCAL_HISTORY_KEY),
      prefRemove(LAST_SYNC_KEY),
    ]);
  },
};
