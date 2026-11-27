import { Capacitor, registerPlugin } from '@capacitor/core';
import { AuthSessionMeta } from '../types';

export interface SecureVaultSecurityInfo {
  storageBackend: 'android_keystore' | 'ios_keychain' | 'web_session';
  hardwareBacked: boolean;
  securityLevel: string;
}

export interface SecureVaultPlugin {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
  clear(): Promise<void>;
  getSecurityInfo?(): Promise<SecureVaultSecurityInfo>;
}

const SecureVault = registerPlugin<SecureVaultPlugin>('SecureVault');

const TOKEN_KEY = 'omnidoc_access_token';
const SESSION_META_KEY = 'omnidoc_session_meta';

// Web/test fallback store kept in memory + sessionStorage (never plaintext localStorage for JWTs)
const memoryFallback = new Map<string, string>();

function getNativePlatformName(): 'android' | 'ios' | 'web' {
  try {
    if (!Capacitor.isNativePlatform()) return 'web';
    const platform = Capacitor.getPlatform();
    if (platform === 'android' || platform === 'ios') return platform;
    return 'web';
  } catch {
    return 'web';
  }
}

function isNativeVaultPlatform(): boolean {
  const platform = getNativePlatformName();
  return platform === 'android' || platform === 'ios';
}

async function vaultSet(key: string, value: string): Promise<void> {
  if (isNativeVaultPlatform()) {
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
  if (isNativeVaultPlatform()) {
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
  if (isNativeVaultPlatform()) {
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
  if (isNativeVaultPlatform()) {
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

const BASE64_URL_PART_RE = /^[A-Za-z0-9_-]+={0,2}$/;

function decodeBase64UrlJson(segment: string): Record<string, any> | null {
  if (!segment || !BASE64_URL_PART_RE.test(segment)) return null;
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, any>;
  } catch {
    return null;
  }
}

export function validateJwtStructure(token: string): boolean {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (!trimmed) return false;
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts.some((p) => !BASE64_URL_PART_RE.test(p))) {
    return false;
  }

  const header = decodeBase64UrlJson(parts[0]);
  if (!header || typeof header.alg !== 'string' || !header.alg.trim() || header.alg.trim().toLowerCase() === 'none') {
    return false;
  }

  const payload = decodeBase64UrlJson(parts[1]);
  if (!payload) return false;
  if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) return false;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= 0) {
    return false;
  }
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf))) {
    return false;
  }
  return true;
}

export function parseJwtPayload(token: string): Record<string, any> | null {
  if (!validateJwtStructure(token)) return null;
  return decodeBase64UrlJson(token.trim().split('.')[1]);
}

export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const payload = parseJwtPayload(token);
  // Fail closed on malformed tokens or missing numeric expiration
  if (!payload || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= 0) {
    return true;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + skewSeconds) {
    return true;
  }
  return payload.exp <= nowSec + skewSeconds;
}

export const secureStorage = {
  async getVaultSecurityInfo(): Promise<SecureVaultSecurityInfo> {
    const nativePlatform = getNativePlatformName();
    if ((nativePlatform === 'android' || nativePlatform === 'ios') && typeof SecureVault.getSecurityInfo === 'function') {
      try {
        return await SecureVault.getSecurityInfo();
      } catch {
        return {
          storageBackend: nativePlatform === 'ios' ? 'ios_keychain' : 'android_keystore',
          hardwareBacked: false,
          securityLevel: 'unavailable',
        };
      }
    }
    return { storageBackend: 'web_session', hardwareBacked: false, securityLevel: 'session_storage' };
  },

  async saveSession(token: string, meta: AuthSessionMeta): Promise<void> {
    await vaultSet(TOKEN_KEY, token);
    await vaultSet(SESSION_META_KEY, JSON.stringify(meta));
  },

  async setAuxiliarySecret(key: string, value: string): Promise<void> {
    await vaultSet(key, value);
  },

  async getAuxiliarySecret(key: string): Promise<string | null> {
    return vaultGet(key);
  },

  async removeAuxiliarySecret(key: string): Promise<void> {
    await vaultRemove(key);
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
