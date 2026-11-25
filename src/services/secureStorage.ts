import { Capacitor, registerPlugin } from '@capacitor/core';
import { AuthSessionMeta } from '../types';

export interface SecureVaultPlugin {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
  clear(): Promise<void>;
}

const SecureVault = registerPlugin<SecureVaultPlugin>('SecureVault');

const TOKEN_KEY = 'omnidoc_access_token';
const SESSION_META_KEY = 'omnidoc_session_meta';

// Web/test fallback store kept in memory + sessionStorage (never plaintext localStorage for JWTs)
const memoryFallback = new Map<string, string>();

function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

async function vaultSet(key: string, value: string): Promise<void> {
  if (isNativeAndroid()) {
    await SecureVault.set({ key, value });
    return;
  }
  memoryFallback.set(key, value);
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // ignore in restricted environments
  }
}

async function vaultGet(key: string): Promise<string | null> {
  if (isNativeAndroid()) {
    const res = await SecureVault.get({ key });
    return res?.value ?? null;
  }
  if (memoryFallback.has(key)) {
    return memoryFallback.get(key) ?? null;
  }
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(key);
    }
  } catch {
    // ignore
  }
  return null;
}

async function vaultRemove(key: string): Promise<void> {
  if (isNativeAndroid()) {
    await SecureVault.remove({ key });
    return;
  }
  memoryFallback.delete(key);
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

async function vaultClear(): Promise<void> {
  if (isNativeAndroid()) {
    await SecureVault.clear();
    return;
  }
  memoryFallback.clear();
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(SESSION_META_KEY);
    }
  } catch {
    // ignore
  }
}

export function parseJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const payload = parseJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp <= nowSec + skewSeconds;
}

export const secureStorage = {
  async saveSession(token: string, meta: AuthSessionMeta): Promise<void> {
    await vaultSet(TOKEN_KEY, token);
    await vaultSet(SESSION_META_KEY, JSON.stringify(meta));
  },

  async updateToken(token: string): Promise<void> {
    await vaultSet(TOKEN_KEY, token);
  },

  async getToken(): Promise<string | null> {
    return vaultGet(TOKEN_KEY);
  },

  async getSessionMeta(): Promise<AuthSessionMeta | null> {
    const raw = await vaultGet(SESSION_META_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthSessionMeta;
    } catch {
      return null;
    }
  },

  async removeToken(): Promise<void> {
    await vaultRemove(TOKEN_KEY);
  },

  async clearAll(): Promise<void> {
    await vaultClear();
  },
};
