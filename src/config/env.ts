import { Preferences } from '@capacitor/preferences';
import { AppEnvironment } from '../types';

const ENV_PREF_KEY = 'omnidoc_mobile_env';
const CUSTOM_URL_PREF_KEY = 'omnidoc_mobile_custom_api_url';

export const DEFAULT_URLS: Record<AppEnvironment, string> = {
  production: import.meta.env.VITE_API_PROD_URL || 'https://omnidoc-studio-jet.vercel.app/api/v1',
  staging: import.meta.env.VITE_API_STAGING_URL || 'https://omnidoc-studio-jet.vercel.app/api/v1',
  development: import.meta.env.VITE_API_DEV_URL || 'http://10.0.2.2:8000/api/v1',
};

export const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 30000);

const DEV_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

export function validateApiUrl(url: string, env: AppEnvironment): { valid: boolean; normalized: string; error?: string } {
  const trimmed = (url || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return { valid: false, normalized: '', error: 'API URL cannot be empty.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, normalized: '', error: 'Invalid URL format.' };
  }

  if (parsed.protocol === 'https:') {
    const normalized = trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
    return { valid: true, normalized };
  }

  if (parsed.protocol === 'http:') {
    if (env === 'development' && DEV_HTTP_HOSTS.has(parsed.hostname)) {
      const normalized = trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
      return { valid: true, normalized };
    }
    return {
      valid: false,
      normalized: '',
      error: 'Security policy requires HTTPS for staging and production APIs (HTTP allowed only for localhost/10.0.2.2 in development).',
    };
  }

  return { valid: false, normalized: '', error: `Unsupported protocol "${parsed.protocol}". Use https://.` };
}

function safeParseEnv(raw: string | undefined | null): AppEnvironment {
  if (raw === 'development' || raw === 'staging' || raw === 'production') {
    return raw;
  }
  return 'production';
}

export class EnvironmentManager {
  private currentEnv: AppEnvironment = safeParseEnv(import.meta.env.VITE_APP_ENV);
  private currentUrl: string =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
    DEFAULT_URLS[this.currentEnv];

  public async init(): Promise<void> {
    try {
      const envRes = await Preferences.get({ key: ENV_PREF_KEY });
      if (envRes.value) {
        this.currentEnv = safeParseEnv(envRes.value);
      }
      const urlRes = await Preferences.get({ key: CUSTOM_URL_PREF_KEY });
      if (urlRes.value) {
        const check = validateApiUrl(urlRes.value, this.currentEnv);
        if (check.valid) {
          this.currentUrl = check.normalized;
          return;
        }
      }
      this.currentUrl = DEFAULT_URLS[this.currentEnv];
    } catch {
      this.currentUrl = DEFAULT_URLS[this.currentEnv];
    }
  }

  public getEnvironment(): AppEnvironment {
    return this.currentEnv;
  }

  public getApiBaseUrl(): string {
    return this.currentUrl;
  }

  public async setConfiguration(env: AppEnvironment, customUrl?: string): Promise<string> {
    const targetUrl = customUrl?.trim() ? customUrl.trim() : DEFAULT_URLS[env];
    const check = validateApiUrl(targetUrl, env);
    if (!check.valid) {
      throw new Error(check.error || 'Invalid API configuration');
    }
    this.currentEnv = env;
    this.currentUrl = check.normalized;
    try {
      await Preferences.set({ key: ENV_PREF_KEY, value: env });
      await Preferences.set({ key: CUSTOM_URL_PREF_KEY, value: check.normalized });
    } catch {
      // Ignore storage failures in test/headless environments
    }
    return this.currentUrl;
  }
}

export const envManager = new EnvironmentManager();
