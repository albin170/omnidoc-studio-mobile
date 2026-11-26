import { envManager, REQUEST_TIMEOUT_MS } from '../config/env';
import { secureStorage } from './secureStorage';
import {
  BackendDocument,
  BackendJob,
  BackendRegisterPayload,
  BackendTokenResponse,
  CloudProjectDetail,
  CloudProjectSummary,
  NotificationListResponse,
  NotificationPreferences,
  UserEntitlements,
  UserUiConfig,
  UserUsageMetrics,
} from '../types';

export class ApiError extends Error {
  public readonly status: number;
  public readonly detail: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

type SessionExpiredListener = (reason: string) => void;

const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ApiError(`Invalid server response for ${context}: expected object.`, 502);
  }
  return value;
}

function assertArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ApiError(`Invalid server response for ${context}: expected list.`, 502);
  }
  return value;
}

function assertNonEmptyString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(`Invalid server response for ${context}: missing "${field}".`, 502);
  }
  return value;
}

function validateTokenResponse(data: unknown, context: string): BackendTokenResponse {
  const obj = assertRecord(data, context);
  assertNonEmptyString(obj.access_token, 'access_token', context);
  assertNonEmptyString(obj.user_id, 'user_id', context);
  assertNonEmptyString(obj.org_id, 'org_id', context);
  assertNonEmptyString(obj.email, 'email', context);
  return obj as unknown as BackendTokenResponse;
}

function validateDocumentShape(data: unknown, context: string): BackendDocument {
  const obj = assertRecord(data, context);
  assertNonEmptyString(obj.id, 'id', context);
  assertNonEmptyString(obj.filename, 'filename', context);
  return obj as unknown as BackendDocument;
}

function validateProjectSummaryShape(data: unknown, context: string): CloudProjectSummary {
  const obj = assertRecord(data, context);
  assertNonEmptyString(obj.id, 'id', context);
  assertNonEmptyString(obj.title, 'title', context);
  if (obj.project_type !== undefined && typeof obj.project_type !== 'string') {
    throw new ApiError(`Invalid server response for ${context}: invalid "project_type".`, 502);
  }
  if (obj.version !== undefined && typeof obj.version !== 'number') {
    throw new ApiError(`Invalid server response for ${context}: invalid "version".`, 502);
  }
  return obj as unknown as CloudProjectSummary;
}

function validateProjectDetailShape(data: unknown, context: string): CloudProjectDetail {
  const summary = validateProjectSummaryShape(data, context);
  return summary as CloudProjectDetail;
}

function validateBackendJobShape(data: unknown, context: string): BackendJob {
  const obj = assertRecord(data, context);
  assertNonEmptyString(obj.id, 'id', context);
  assertNonEmptyString(obj.status, 'status', context);
  return obj as unknown as BackendJob;
}

function validateNotificationListShape(data: unknown): NotificationListResponse {
  const obj = assertRecord(data, 'notifications');
  assertArray(obj.items, 'notifications.items');
  if (typeof obj.unread_count !== 'number') {
    throw new ApiError('Invalid server response for notifications: missing "unread_count".', 502);
  }
  return obj as unknown as NotificationListResponse;
}

export class OmniDocMobileApiClient {
  private token: string | null = null;
  private onSessionExpired: SessionExpiredListener | null = null;
  private readonly inFlightMutations = new Map<string, Promise<unknown>>();

  public setToken(token: string | null): void {
    this.token = token;
  }

  public getToken(): string | null {
    return this.token;
  }

  public setSessionExpiredHandler(handler: SessionExpiredListener | null): void {
    this.onSessionExpired = handler;
  }

  public getBaseUrl(): string {
    return envManager.getApiBaseUrl();
  }

  private runDedupedMutation<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlightMutations.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = fn().finally(() => {
      if (this.inFlightMutations.get(key) === promise) {
        this.inFlightMutations.delete(key);
      }
    });
    this.inFlightMutations.set(key, promise);
    return promise;
  }

  private async buildHeaders(extra?: Record<string, string>, includeJson = true): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (includeJson) {
      headers['Content-Type'] = 'application/json';
    }
    const token = this.token || (await secureStorage.getToken());
    if (token) {
      this.token = token;
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (extra) {
      Object.assign(headers, extra);
    }
    return headers;
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit = {},
    options: { skipAuth?: boolean; retries?: number; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<T> {
    const externalSignal = options.signal ?? init.signal ?? undefined;
    if (externalSignal?.aborted) {
      throw new ApiError('Request cancelled.', 0);
    }

    const method = (init.method || 'GET').toUpperCase();
    const maxRetries = options.retries ?? (method === 'GET' ? 2 : 0);
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const baseUrl = this.getBaseUrl();
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (externalSignal?.aborted) {
        throw new ApiError('Request cancelled.', 0);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
      const onExternalAbort = () => controller.abort('cancelled');
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

      try {
        const headers = options.skipAuth
          ? { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
          : await this.buildHeaders(init.headers as Record<string, string> | undefined);

        const res = await fetch(url, {
          ...init,
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);

        if (res.status === 401 && !options.skipAuth) {
          this.token = null;
          await secureStorage.clearAll();
          this.onSessionExpired?.('Your session expired or was revoked. Please sign in again.');
          throw new ApiError('Session expired or unauthorized', 401);
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: res.statusText }));
          const message =
            typeof body?.detail === 'string'
              ? body.detail
              : body?.detail?.message || body?.message || `HTTP ${res.status}: ${res.statusText}`;

          if (RETRYABLE_STATUSES.has(res.status) && attempt < maxRetries) {
            await sleep(300 * Math.pow(2, attempt));
            continue;
          }
          throw new ApiError(message, res.status, body?.detail ?? body);
        }

        const text = await res.text();
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ApiError('Server returned malformed JSON response.', 502);
        }
      } catch (err: any) {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);
        if (err instanceof ApiError) {
          throw err;
        }
        if (externalSignal?.aborted) {
          throw new ApiError('Request cancelled.', 0);
        }
        const isAbort = err?.name === 'AbortError' || controller.signal.aborted;
        lastError = new ApiError(
          isAbort ? 'Request timed out. Check your network connection.' : err?.message || 'Network request failed',
          0
        );
        if (attempt < maxRetries && !isAbort) {
          await sleep(300 * Math.pow(2, attempt));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new ApiError('Request failed', 0);
  }

  // --- Health ---

  public async getHealth(
    customBaseUrl?: string,
    signal?: AbortSignal
  ): Promise<{ status: string; platform?: string; version?: string }> {
    const base = (customBaseUrl || this.getBaseUrl()).replace(/\/+$/, '');
    try {
      const res = await this.requestJson(
        `${base}/health`,
        {},
        { skipAuth: true, retries: 0, timeoutMs: 6000, signal }
      );
      const obj = assertRecord(res, 'health');
      assertNonEmptyString(obj.status, 'status', 'health');
      return obj as { status: string; platform?: string; version?: string };
    } catch (err) {
      if (signal?.aborted) throw err;
      const root = base.replace(/\/api\/v1$/, '');
      const res = await this.requestJson(
        `${root}/health`,
        {},
        { skipAuth: true, retries: 0, timeoutMs: 6000, signal }
      );
      const obj = assertRecord(res, 'health');
      assertNonEmptyString(obj.status, 'status', 'health');
      return obj as { status: string; platform?: string; version?: string };
    }
  }

  // --- Authentication ---

  public async register(payload: BackendRegisterPayload, signal?: AbortSignal): Promise<any> {
    const key = `POST:/auth/register:${payload.email.trim().toLowerCase()}`;
    return this.runDedupedMutation(key, async () => {
      const res = await this.requestJson(
        '/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            organization_name: payload.organization_name?.trim() || `${payload.full_name}'s Workspace`,
            terms_version: payload.terms_version || '2026.1',
            privacy_version: payload.privacy_version || '2026.1',
            ai_consent_version: payload.ai_consent_version || '2026.1',
          }),
        },
        { skipAuth: true, signal }
      );
      return assertRecord(res, 'register');
    });
  }

  public async login(email: string, password: string, signal?: AbortSignal): Promise<BackendTokenResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    return this.runDedupedMutation(`POST:/auth/login:${normalizedEmail}`, async () => {
      const res = await this.requestJson<BackendTokenResponse>(
        '/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email: normalizedEmail, password }),
        },
        { skipAuth: true, signal }
      );
      const validated = validateTokenResponse(res, 'login');
      this.token = validated.access_token;
      return validated;
    });
  }

  public async adminLogin(email: string, password: string, signal?: AbortSignal): Promise<BackendTokenResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    return this.runDedupedMutation(`POST:/admin/auth/login:${normalizedEmail}`, async () => {
      const res = await this.requestJson<BackendTokenResponse>(
        '/admin/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email: normalizedEmail, password }),
        },
        { skipAuth: true, signal }
      );
      const validated = validateTokenResponse(res, 'adminLogin');
      this.token = validated.access_token;
      return validated;
    });
  }

  public async logout(): Promise<void> {
    return this.runDedupedMutation('POST:/auth/logout', async () => {
      try {
        if (this.token) {
          await this.requestJson('/auth/logout', { method: 'POST' }, { retries: 0, timeoutMs: 5000 });
        }
      } finally {
        this.token = null;
      }
    });
  }

  public async getMe(signal?: AbortSignal): Promise<any> {
    const res = await this.requestJson('/auth/me', {}, { signal });
    const obj = assertRecord(res, 'getMe');
    assertNonEmptyString(obj.id, 'id', 'getMe');
    assertNonEmptyString(obj.email, 'email', 'getMe');
    return obj;
  }

  public async forgotPassword(email: string, signal?: AbortSignal): Promise<{ status: string; message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    return this.runDedupedMutation(`POST:/auth/forgot-password:${normalizedEmail}`, async () => {
      const res = await this.requestJson(
        '/auth/forgot-password',
        { method: 'POST', body: JSON.stringify({ email: normalizedEmail }) },
        { skipAuth: true, signal }
      );
      return assertRecord(res, 'forgotPassword') as { status: string; message: string };
    });
  }

  public async resetPassword(
    token: string,
    newPassword: string,
    signal?: AbortSignal
  ): Promise<{ status: string; message: string }> {
    return this.runDedupedMutation(`POST:/auth/reset-password:${token.trim()}`, async () => {
      const res = await this.requestJson(
        '/auth/reset-password',
        { method: 'POST', body: JSON.stringify({ token: token.trim(), new_password: newPassword }) },
        { skipAuth: true, signal }
      );
      return assertRecord(res, 'resetPassword') as { status: string; message: string };
    });
  }

  public async getConsentHistory(signal?: AbortSignal): Promise<any[]> {
    const res = await this.requestJson('/auth/consent/history', {}, { signal });
    return assertArray(res, 'consentHistory');
  }

  public async grantConsent(
    payload: { ai_consent?: boolean; marketing_consent?: boolean },
    signal?: AbortSignal
  ): Promise<any> {
    const key = `POST:/auth/consent/grant:${Boolean(payload.ai_consent)}:${Boolean(payload.marketing_consent)}`;
    return this.runDedupedMutation(key, async () => {
      const res = await this.requestJson(
        '/auth/consent/grant',
        {
          method: 'POST',
          body: JSON.stringify({
            terms_version: '2026.1',
            privacy_version: '2026.1',
            ai_consent_version: '2026.1',
            ...payload,
          }),
        },
        { signal }
      );
      return assertRecord(res, 'grantConsent');
    });
  }

  public async withdrawConsent(consentType: string, signal?: AbortSignal): Promise<any> {
    return this.runDedupedMutation(`POST:/auth/consent/withdraw:${consentType}`, async () => {
      const res = await this.requestJson(
        '/auth/consent/withdraw',
        {
          method: 'POST',
          body: JSON.stringify({ consent_type: consentType }),
        },
        { signal }
      );
      return assertRecord(res, 'withdrawConsent');
    });
  }

  // --- User Portal & Settings ---

  public async getEntitlements(signal?: AbortSignal): Promise<UserEntitlements> {
    const res = await this.requestJson('/users/me/entitlements', {}, { signal });
    return assertRecord(res, 'entitlements') as unknown as UserEntitlements;
  }

  public async getUsage(signal?: AbortSignal): Promise<UserUsageMetrics> {
    const res = await this.requestJson('/users/me/usage', {}, { signal });
    return assertRecord(res, 'usage') as unknown as UserUsageMetrics;
  }

  public async getSubscription(signal?: AbortSignal): Promise<any> {
    const res = await this.requestJson('/users/me/subscription', {}, { signal });
    return assertRecord(res, 'subscription');
  }

  public async getUiConfig(signal?: AbortSignal): Promise<UserUiConfig> {
    const res = await this.requestJson('/users/me/ui-config', {}, { signal });
    return assertRecord(res, 'uiConfig') as unknown as UserUiConfig;
  }

  public async updateProfile(fullName: string, signal?: AbortSignal): Promise<any> {
    const trimmed = fullName.trim();
    return this.runDedupedMutation(`PUT:/users/me:${trimmed}`, async () => {
      const res = await this.requestJson(
        '/users/me',
        {
          method: 'PUT',
          body: JSON.stringify({ full_name: trimmed }),
        },
        { signal }
      );
      return assertRecord(res, 'updateProfile');
    });
  }

  public async changePassword(
    currentPassword: string,
    newPassword: string,
    signal?: AbortSignal
  ): Promise<{ status: string; message: string; access_token?: string }> {
    return this.runDedupedMutation('POST:/users/me/change-password', async () => {
      const res = await this.requestJson<{ status: string; message: string; access_token?: string }>(
        '/users/me/change-password',
        {
          method: 'POST',
          body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
        },
        { signal }
      );
      const obj = assertRecord(res, 'changePassword') as {
        status: string;
        message: string;
        access_token?: string;
      };
      if (obj.access_token) {
        this.token = obj.access_token;
        await secureStorage.updateToken(obj.access_token);
      }
      return obj;
    });
  }

  public async exportMyData(signal?: AbortSignal): Promise<any> {
    const res = await this.requestJson('/users/me/export', {}, { timeoutMs: 60000, signal });
    return assertRecord(res, 'exportMyData');
  }

  public async deleteAccount(signal?: AbortSignal): Promise<any> {
    return this.runDedupedMutation('DELETE:/users/me', async () => {
      const res = await this.requestJson('/users/me', { method: 'DELETE' }, { signal });
      return assertRecord(res, 'deleteAccount');
    });
  }

  public async getApiKeys(signal?: AbortSignal): Promise<any[]> {
    const res = await this.requestJson('/developer/keys', {}, { signal });
    return assertArray(res, 'apiKeys');
  }

  public async createApiKey(name: string, scopes?: string, signal?: AbortSignal): Promise<any> {
    const key = `POST:/developer/keys:${name.trim()}:${scopes || ''}`;
    return this.runDedupedMutation(key, async () => {
      const res = await this.requestJson(
        '/developer/keys',
        {
          method: 'POST',
          body: JSON.stringify({ name, scopes }),
        },
        { signal }
      );
      return assertRecord(res, 'createApiKey');
    });
  }

  public async revokeApiKey(keyId: string, signal?: AbortSignal): Promise<void> {
    await this.runDedupedMutation(`DELETE:/developer/keys/${keyId}`, async () => {
      await this.requestJson(`/developer/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' }, { signal });
    });
  }

  // --- Documents ---

  public async listDocuments(signal?: AbortSignal): Promise<BackendDocument[]> {
    const res = await this.requestJson('/documents', {}, { signal });
    return assertArray(res, 'listDocuments').map((item, idx) =>
      validateDocumentShape(item, `listDocuments[${idx}]`)
    );
  }

  public async getDocument(documentId: string, signal?: AbortSignal): Promise<BackendDocument> {
    const res = await this.requestJson(`/documents/${encodeURIComponent(documentId)}`, {}, { signal });
    return validateDocumentShape(res, 'getDocument');
  }

  public async uploadDocument(
    file: File,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal
  ): Promise<BackendDocument> {
    if (signal?.aborted) {
      throw new ApiError('Upload cancelled.', 0);
    }

    const executeUpload = async (): Promise<BackendDocument> => {
      const token = this.token || (await secureStorage.getToken());
      const url = `${this.getBaseUrl()}/documents/upload`;
      const formData = new FormData();
      formData.append('file', file, file.name);

      // Use XHR when available in browser/WebView to expose genuine upload progress events
      if (typeof XMLHttpRequest !== 'undefined' && onProgress) {
        return new Promise<BackendDocument>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          let settled = false;

          const cleanup = () => {
            signal?.removeEventListener('abort', onAbort);
          };

          const onAbort = () => {
            if (!settled) {
              xhr.abort();
            }
          };

          if (signal) {
            if (signal.aborted) {
              reject(new ApiError('Upload cancelled.', 0));
              return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
          }

          xhr.open('POST', url, true);
          xhr.timeout = Math.max(REQUEST_TIMEOUT_MS, 120000);
          if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable && ev.total > 0) {
              onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
            }
          };
          xhr.onload = () => {
            settled = true;
            cleanup();
            if (xhr.status === 401) {
              this.token = null;
              secureStorage.clearAll().catch(() => {});
              this.onSessionExpired?.('Session expired during upload. Please sign in again.');
              reject(new ApiError('Unauthorized', 401));
              return;
            }
            let parsed: any = null;
            try {
              parsed = JSON.parse(xhr.responseText || '{}');
            } catch {
              parsed = { detail: xhr.statusText };
            }
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const validated = validateDocumentShape(parsed, 'uploadDocument');
                onProgress(100);
                resolve(validated);
              } catch (validationErr) {
                reject(validationErr);
              }
            } else {
              reject(new ApiError(parsed?.detail || `Upload failed (${xhr.status})`, xhr.status, parsed));
            }
          };
          xhr.onabort = () => {
            settled = true;
            cleanup();
            reject(new ApiError('Upload cancelled.', 0));
          };
          xhr.onerror = () => {
            settled = true;
            cleanup();
            reject(new ApiError('Network error during document upload.', 0));
          };
          xhr.ontimeout = () => {
            settled = true;
            cleanup();
            reject(new ApiError('Upload timed out. Check connection stability.', 0));
          };
          xhr.send(formData);
        });
      }

      const controller = new AbortController();
      const timeoutMs = Math.max(REQUEST_TIMEOUT_MS, 120000);
      const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
      const onExternalAbort = () => controller.abort('cancelled');
      signal?.addEventListener('abort', onExternalAbort, { once: true });

      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(url, { method: 'POST', headers, body: formData, signal: controller.signal });
        clearTimeout(timer);

        if (res.status === 401) {
          this.token = null;
          await secureStorage.clearAll();
          this.onSessionExpired?.('Session expired during upload.');
          throw new ApiError('Unauthorized', 401);
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: res.statusText }));
          throw new ApiError(body?.detail || 'Upload failed', res.status, body);
        }
        const json = await res.json().catch(() => null);
        const validated = validateDocumentShape(json, 'uploadDocument');
        onProgress?.(100);
        return validated;
      } catch (err: any) {
        if (err instanceof ApiError) throw err;
        if (signal?.aborted) throw new ApiError('Upload cancelled.', 0);
        if (err?.name === 'AbortError' || controller.signal.aborted) {
          throw new ApiError('Upload timed out. Check connection stability.', 0);
        }
        throw new ApiError(err?.message || 'Upload failed', 0);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onExternalAbort);
      }
    };

    if (signal) {
      return executeUpload();
    }
    const dedupeKey = `POST:/documents/upload:${file.name}:${file.size}:${file.lastModified}`;
    return this.runDedupedMutation(dedupeKey, executeUpload);
  }

  public async downloadDocument(
    documentId: string,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal
  ): Promise<Blob> {
    if (signal?.aborted) {
      throw new ApiError('Document download cancelled.', 0);
    }

    const token = this.token || (await secureStorage.getToken());
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeoutMs = Math.max(REQUEST_TIMEOUT_MS, 120000);
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    const onExternalAbort = () => controller.abort('cancelled');
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const res = await fetch(`${this.getBaseUrl()}/documents/${encodeURIComponent(documentId)}/download`, {
        headers,
        signal: controller.signal,
      });

      if (res.status === 401) {
        this.token = null;
        await secureStorage.clearAll();
        this.onSessionExpired?.('Session expired. Please sign in again.');
        throw new ApiError('Unauthorized', 401);
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new ApiError(
          typeof err?.detail === 'string' ? err.detail : err?.detail?.message || 'Document download failed',
          res.status,
          err?.detail ?? err
        );
      }

      const contentType = res.headers.get('content-type') || 'application/octet-stream';

      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const rawLength = res.headers.get('content-length');
        const totalBytes = rawLength ? Number(rawLength) : 0;
        const hasKnownLength = Number.isFinite(totalBytes) && totalBytes > 0;
        const chunks: BlobPart[] = [];
        let receivedBytes = 0;

        try {
          while (true) {
            if (signal?.aborted || controller.signal.aborted) {
              await reader.cancel().catch(() => {});
              throw new ApiError(
                signal?.aborted ? 'Document download cancelled.' : 'Document download timed out.',
                0
              );
            }
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) {
              chunks.push(new Uint8Array(value));
              receivedBytes += value.byteLength;
              if (onProgress) {
                if (hasKnownLength) {
                  onProgress(Math.min(99, Math.round((receivedBytes / totalBytes) * 100)));
                } else {
                  const estimated = Math.min(
                    95,
                    Math.max(5, Math.round((receivedBytes / (receivedBytes + 65536)) * 100))
                  );
                  onProgress(estimated);
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        onProgress?.(100);
        return new Blob(chunks, { type: contentType });
      }

      const blob = await res.blob();
      onProgress?.(100);
      return blob;
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      if (signal?.aborted) {
        throw new ApiError('Document download cancelled.', 0);
      }
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        throw new ApiError('Document download timed out.', 0);
      }
      throw new ApiError(err?.message || 'Document download failed', 0);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  public async deleteDocument(documentId: string, signal?: AbortSignal): Promise<any> {
    return this.runDedupedMutation(`DELETE:/documents/${documentId}`, async () => {
      return this.requestJson(`/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }, { signal });
    });
  }

  // --- Cloud Projects ---

  public async listProjects(signal?: AbortSignal): Promise<CloudProjectSummary[]> {
    const res = await this.requestJson('/projects', {}, { signal });
    return assertArray(res, 'listProjects').map((item, idx) =>
      validateProjectSummaryShape(item, `listProjects[${idx}]`)
    );
  }

  public async getProject(projectId: string, signal?: AbortSignal): Promise<CloudProjectDetail> {
    const res = await this.requestJson(`/projects/${encodeURIComponent(projectId)}`, {}, { signal });
    return validateProjectDetailShape(res, 'getProject');
  }

  public async createProject(
    payload: {
      client_id?: string;
      title: string;
      project_type: 'pdf' | 'docx' | 'slides' | 'sheets' | 'image' | 'ocr';
      data: any;
      tags?: string[];
      note?: string;
    },
    signal?: AbortSignal
  ): Promise<CloudProjectDetail> {
    const key = `POST:/projects:${payload.project_type}:${payload.title.trim()}:${payload.client_id || ''}`;
    return this.runDedupedMutation(key, async () => {
      const res = await this.requestJson(
        '/projects',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        { signal }
      );
      return validateProjectDetailShape(res, 'createProject');
    });
  }

  public async updateProject(
    projectId: string,
    payload: { title?: string; data?: any; note?: string; expected_version?: number; force_overwrite?: boolean },
    signal?: AbortSignal
  ): Promise<CloudProjectDetail> {
    const key = `PUT:/projects/${projectId}:${payload.expected_version ?? 'any'}:${payload.title ?? ''}`;
    return this.runDedupedMutation(key, async () => {
      const res = await this.requestJson(
        `/projects/${encodeURIComponent(projectId)}`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
        { signal }
      );
      return validateProjectDetailShape(res, 'updateProject');
    });
  }

  public async renameProject(
    projectId: string,
    title: string,
    expectedVersion?: number,
    signal?: AbortSignal
  ): Promise<CloudProjectSummary> {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new ApiError('Project title cannot be empty.', 400);
    }
    const key = `PATCH:/projects/${projectId}/rename:${trimmedTitle}:${expectedVersion ?? 'any'}`;
    return this.runDedupedMutation(key, async () => {
      const body: { title: string; expected_version?: number } = { title: trimmedTitle };
      if (expectedVersion !== undefined) {
        body.expected_version = expectedVersion;
      }
      const res = await this.requestJson(
        `/projects/${encodeURIComponent(projectId)}/rename`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
        { signal }
      );
      return validateProjectSummaryShape(res, 'renameProject');
    });
  }

  public async deleteProject(projectId: string, signal?: AbortSignal): Promise<any> {
    return this.runDedupedMutation(`DELETE:/projects/${projectId}`, async () => {
      return this.requestJson(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }, { signal });
    });
  }

  // --- Jobs & Tools ---

  public async listJobs(signal?: AbortSignal): Promise<BackendJob[]> {
    const res = await this.requestJson('/jobs', {}, { signal });
    return assertArray(res, 'listJobs').map((item, idx) => validateBackendJobShape(item, `listJobs[${idx}]`));
  }

  public async submitJob(
    title: string,
    objective: string,
    documentIds: string[],
    mode = 'hybrid',
    signal?: AbortSignal
  ): Promise<BackendJob> {
    const key = `POST:/jobs:${title.trim()}:${mode}:${documentIds.join(',')}`;
    return this.runDedupedMutation(key, async () => {
      const res = await this.requestJson(
        '/jobs',
        {
          method: 'POST',
          body: JSON.stringify({ title, objective, document_ids: documentIds, mode }),
        },
        { signal }
      );
      return validateBackendJobShape(res, 'submitJob');
    });
  }

  public async approveJob(
    jobId: string,
    approved: boolean,
    rejectionReason?: string,
    signal?: AbortSignal
  ): Promise<BackendJob> {
    return this.runDedupedMutation(`POST:/jobs/${jobId}/approve:${approved}`, async () => {
      const res = await this.requestJson(
        `/jobs/${encodeURIComponent(jobId)}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({ approved, rejection_reason: rejectionReason }),
        },
        { signal }
      );
      return validateBackendJobShape(res, 'approveJob');
    });
  }

  public async cancelJob(jobId: string, signal?: AbortSignal): Promise<BackendJob> {
    return this.runDedupedMutation(`POST:/jobs/${jobId}/cancel`, async () => {
      const res = await this.requestJson(
        `/jobs/${encodeURIComponent(jobId)}/cancel`,
        { method: 'POST' },
        { signal }
      );
      return validateBackendJobShape(res, 'cancelJob');
    });
  }

  public async listTools(signal?: AbortSignal): Promise<any[]> {
    const res = await this.requestJson('/tools', {}, { signal });
    return assertArray(res, 'listTools');
  }

  public async invokeTool(
    toolName: string,
    args: Record<string, any>,
    idempotencyKey?: string,
    signal?: AbortSignal
  ): Promise<any> {
    const dedupeSuffix = idempotencyKey || JSON.stringify(args);
    return this.runDedupedMutation(`POST:/tools/invoke:${toolName}:${dedupeSuffix}`, async () => {
      return this.requestJson(
        '/tools/invoke',
        {
          method: 'POST',
          body: JSON.stringify({
            tool_name: toolName,
            arguments: args,
            idempotency_key: idempotencyKey || `mob_${Date.now()}`,
          }),
        },
        { signal }
      );
    });
  }

  // --- AI & Local RAG ---

  public async listAgents(signal?: AbortSignal): Promise<any[]> {
    const res = await this.requestJson('/agents', {}, { signal });
    return assertArray(res, 'listAgents');
  }

  public async executeAgent(
    prompt: string,
    documentIds: string[] = [],
    mode: 'single' | 'multi' | 'autonomous' = 'single',
    signal?: AbortSignal
  ): Promise<any> {
    const key = `POST:/agents/execute:${mode}:${documentIds.join(',')}:${prompt.trim()}`;
    return this.runDedupedMutation(key, async () => {
      const res = await this.requestJson(
        '/agents/execute',
        {
          method: 'POST',
          body: JSON.stringify({ prompt, document_ids: documentIds, mode }),
        },
        { timeoutMs: 60000, signal }
      );
      return assertRecord(res, 'executeAgent');
    });
  }

  public async indexDocumentRag(
    documentId: string,
    signal?: AbortSignal
  ): Promise<{ document_id: string; chunks_indexed: number }> {
    return this.runDedupedMutation(`POST:/local-ai/rag/index/${documentId}`, async () => {
      const res = await this.requestJson(
        `/local-ai/rag/index/${encodeURIComponent(documentId)}`,
        { method: 'POST' },
        { signal }
      );
      return assertRecord(res, 'indexDocumentRag') as { document_id: string; chunks_indexed: number };
    });
  }

  public async queryRag(question: string, documentIds: string[] = [], signal?: AbortSignal): Promise<any> {
    const res = await this.requestJson(
      '/local-ai/rag/query',
      {
        method: 'POST',
        body: JSON.stringify({ question, document_ids: documentIds, top_k: 5 }),
      },
      { signal }
    );
    return assertRecord(res, 'queryRag');
  }

  // --- Notifications, Announcements & Support Messages ---

  public async listNotifications(
    params: { category?: string; status?: 'all' | 'unread' | 'read'; limit?: number } = {},
    signal?: AbortSignal
  ): Promise<NotificationListResponse> {
    const q = new URLSearchParams();
    if (params.category) q.set('category', params.category);
    if (params.status) q.set('status', params.status);
    if (params.limit) q.set('limit', String(params.limit));
    const res = await this.requestJson(`/notifications?${q.toString()}`, {}, { signal });
    return validateNotificationListShape(res);
  }

  public async markNotificationRead(id: string, signal?: AbortSignal): Promise<any> {
    return this.runDedupedMutation(`PATCH:/notifications/${id}/read`, async () => {
      return this.requestJson(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }, { signal });
    });
  }

  public async markAllNotificationsRead(signal?: AbortSignal): Promise<any> {
    return this.runDedupedMutation('POST:/notifications/read-all', async () => {
      return this.requestJson('/notifications/read-all', { method: 'POST' }, { signal });
    });
  }

  public async deleteNotification(id: string, signal?: AbortSignal): Promise<any> {
    return this.runDedupedMutation(`DELETE:/notifications/${id}`, async () => {
      return this.requestJson(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }, { signal });
    });
  }

  public async getNotificationPreferences(signal?: AbortSignal): Promise<NotificationPreferences> {
    const res = await this.requestJson('/notifications/preferences', {}, { signal });
    return assertRecord(res, 'notificationPreferences') as unknown as NotificationPreferences;
  }

  public async updateNotificationPreferences(
    payload: Partial<NotificationPreferences>,
    signal?: AbortSignal
  ): Promise<NotificationPreferences> {
    return this.runDedupedMutation(`PUT:/notifications/preferences:${JSON.stringify(payload)}`, async () => {
      const res = await this.requestJson(
        '/notifications/preferences',
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
        { signal }
      );
      return assertRecord(res, 'updateNotificationPreferences') as unknown as NotificationPreferences;
    });
  }

  public async getActiveAnnouncements(signal?: AbortSignal): Promise<{ items: any[] }> {
    const res = await this.requestJson('/announcements/active', {}, { signal });
    const obj = assertRecord(res, 'activeAnnouncements');
    assertArray(obj.items, 'activeAnnouncements.items');
    return obj as { items: any[] };
  }

  public async dismissAnnouncement(id: string, signal?: AbortSignal): Promise<any> {
    return this.runDedupedMutation(`POST:/announcements/${id}/dismiss`, async () => {
      return this.requestJson(`/announcements/${encodeURIComponent(id)}/dismiss`, { method: 'POST' }, { signal });
    });
  }

  public async getInbox(signal?: AbortSignal): Promise<any> {
    return this.requestJson('/messages/inbox', {}, { signal });
  }

  public async sendSupportMessage(
    subject: string,
    body: string,
    priority: 'normal' | 'important' | 'urgent' = 'normal',
    signal?: AbortSignal
  ): Promise<any> {
    const key = `POST:/messages/support/send:${priority}:${subject.trim()}`;
    return this.runDedupedMutation(key, async () => {
      return this.requestJson(
        '/messages/support/send',
        {
          method: 'POST',
          body: JSON.stringify({ subject, body, priority }),
        },
        { signal }
      );
    });
  }

  // --- Admin Console (Server-verified admin/superadmin only) ---

  public async getAdminTelemetry(signal?: AbortSignal): Promise<any> {
    const res = await this.requestJson('/admin/telemetry', {}, { signal });
    return assertRecord(res, 'adminTelemetry');
  }

  public async getAdminUsers(search = '', signal?: AbortSignal): Promise<any[]> {
    const q = new URLSearchParams();
    if (search.trim()) q.set('search', search.trim());
    q.set('limit', '50');
    const res = await this.requestJson(`/admin/users?${q.toString()}`, {}, { signal });
    return assertArray(res, 'adminUsers');
  }

  public async suspendUser(userId: string, reason: string, signal?: AbortSignal): Promise<any> {
    return this.runDedupedMutation(`POST:/admin/users/${userId}/suspend`, async () => {
      return this.requestJson(
        `/admin/users/${encodeURIComponent(userId)}/suspend`,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
        },
        { signal }
      );
    });
  }

  public async reactivateUser(userId: string, signal?: AbortSignal): Promise<any> {
    return this.runDedupedMutation(`POST:/admin/users/${userId}/reactivate`, async () => {
      return this.requestJson(`/admin/users/${encodeURIComponent(userId)}/reactivate`, { method: 'POST' }, { signal });
    });
  }

  public async getAdminUiConfig(signal?: AbortSignal): Promise<any> {
    const res = await this.requestJson('/admin/ui-config', {}, { signal });
    return assertRecord(res, 'adminUiConfig');
  }

  public async updateAdminUiConfig(
    payload: {
      announcement_banner?: string;
      maintenance_mode?: boolean;
      maintenance_message?: string;
    },
    signal?: AbortSignal
  ): Promise<any> {
    return this.runDedupedMutation(`PATCH:/admin/ui-config:${JSON.stringify(payload)}`, async () => {
      const res = await this.requestJson(
        '/admin/ui-config',
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
        { signal }
      );
      return assertRecord(res, 'updateAdminUiConfig');
    });
  }

  public async getAdminAuditLogs(limit = 30, signal?: AbortSignal): Promise<any[]> {
    const res = await this.requestJson(`/admin/audit-logs?limit=${limit}`, {}, { signal });
    return assertArray(res, 'adminAuditLogs');
  }
}

export const apiClient = new OmniDocMobileApiClient();
