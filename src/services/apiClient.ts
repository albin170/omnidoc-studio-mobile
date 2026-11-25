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

export class OmniDocMobileApiClient {
  private token: string | null = null;
  private onSessionExpired: SessionExpiredListener | null = null;

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
    options: { skipAuth?: boolean; retries?: number; timeoutMs?: number } = {}
  ): Promise<T> {
    const method = (init.method || 'GET').toUpperCase();
    const maxRetries = options.retries ?? (method === 'GET' ? 2 : 0);
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const baseUrl = this.getBaseUrl();
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers = options.skipAuth
          ? { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
          : await this.buildHeaders(init.headers as Record<string, string> | undefined);

        const res = await fetch(url, {
          ...init,
          headers,
          signal: init.signal || controller.signal,
        });
        clearTimeout(timer);

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
        return (text ? JSON.parse(text) : {}) as T;
      } catch (err: any) {
        clearTimeout(timer);
        if (err instanceof ApiError) {
          throw err;
        }
        const isAbort = err?.name === 'AbortError';
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

  public async getHealth(customBaseUrl?: string): Promise<{ status: string; platform?: string; version?: string }> {
    const base = (customBaseUrl || this.getBaseUrl()).replace(/\/+$/, '');
    try {
      return await this.requestJson(`${base}/health`, {}, { skipAuth: true, retries: 0, timeoutMs: 6000 });
    } catch {
      const root = base.replace(/\/api\/v1$/, '');
      return await this.requestJson(`${root}/health`, {}, { skipAuth: true, retries: 0, timeoutMs: 6000 });
    }
  }

  // --- Authentication ---

  public async register(payload: BackendRegisterPayload): Promise<any> {
    return this.requestJson(
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
      { skipAuth: true }
    );
  }

  public async login(email: string, password: string): Promise<BackendTokenResponse> {
    const res = await this.requestJson<BackendTokenResponse>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      },
      { skipAuth: true }
    );
    this.token = res.access_token;
    return res;
  }

  public async adminLogin(email: string, password: string): Promise<BackendTokenResponse> {
    const res = await this.requestJson<BackendTokenResponse>(
      '/admin/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      },
      { skipAuth: true }
    );
    this.token = res.access_token;
    return res;
  }

  public async logout(): Promise<void> {
    try {
      if (this.token) {
        await this.requestJson('/auth/logout', { method: 'POST' }, { retries: 0, timeoutMs: 5000 });
      }
    } finally {
      this.token = null;
    }
  }

  public async getMe(): Promise<any> {
    return this.requestJson('/auth/me');
  }

  public async forgotPassword(email: string): Promise<{ status: string; message: string }> {
    return this.requestJson(
      '/auth/forgot-password',
      { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }) },
      { skipAuth: true }
    );
  }

  public async resetPassword(token: string, newPassword: string): Promise<{ status: string; message: string }> {
    return this.requestJson(
      '/auth/reset-password',
      { method: 'POST', body: JSON.stringify({ token: token.trim(), new_password: newPassword }) },
      { skipAuth: true }
    );
  }

  public async getConsentHistory(): Promise<any[]> {
    return this.requestJson('/auth/consent/history');
  }

  public async grantConsent(payload: { ai_consent?: boolean; marketing_consent?: boolean }): Promise<any> {
    return this.requestJson('/auth/consent/grant', {
      method: 'POST',
      body: JSON.stringify({
        terms_version: '2026.1',
        privacy_version: '2026.1',
        ai_consent_version: '2026.1',
        ...payload,
      }),
    });
  }

  public async withdrawConsent(consentType: string): Promise<any> {
    return this.requestJson('/auth/consent/withdraw', {
      method: 'POST',
      body: JSON.stringify({ consent_type: consentType }),
    });
  }

  // --- User Portal & Settings ---

  public async getEntitlements(): Promise<UserEntitlements> {
    return this.requestJson('/users/me/entitlements');
  }

  public async getUsage(): Promise<UserUsageMetrics> {
    return this.requestJson('/users/me/usage');
  }

  public async getSubscription(): Promise<any> {
    return this.requestJson('/users/me/subscription');
  }

  public async getUiConfig(): Promise<UserUiConfig> {
    return this.requestJson('/users/me/ui-config');
  }

  public async updateProfile(fullName: string): Promise<any> {
    return this.requestJson('/users/me', {
      method: 'PUT',
      body: JSON.stringify({ full_name: fullName.trim() }),
    });
  }

  public async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<{ status: string; message: string; access_token?: string }> {
    const res = await this.requestJson<{ status: string; message: string; access_token?: string }>(
      '/users/me/change-password',
      {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      }
    );
    if (res.access_token) {
      this.token = res.access_token;
      await secureStorage.updateToken(res.access_token);
    }
    return res;
  }

  public async exportMyData(): Promise<any> {
    return this.requestJson('/users/me/export', {}, { timeoutMs: 60000 });
  }

  public async deleteAccount(): Promise<any> {
    return this.requestJson('/users/me', { method: 'DELETE' });
  }

  public async getApiKeys(): Promise<any[]> {
    return this.requestJson('/developer/keys');
  }

  public async createApiKey(name: string, scopes?: string): Promise<any> {
    return this.requestJson('/developer/keys', {
      method: 'POST',
      body: JSON.stringify({ name, scopes }),
    });
  }

  public async revokeApiKey(keyId: string): Promise<void> {
    await this.requestJson(`/developer/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' });
  }

  // --- Documents ---

  public async listDocuments(): Promise<BackendDocument[]> {
    return this.requestJson('/documents');
  }

  public async getDocument(documentId: string): Promise<BackendDocument> {
    return this.requestJson(`/documents/${encodeURIComponent(documentId)}`);
  }

  public async uploadDocument(file: File, onProgress?: (percent: number) => void): Promise<BackendDocument> {
    const token = this.token || (await secureStorage.getToken());
    const url = `${this.getBaseUrl()}/documents/upload`;
    const formData = new FormData();
    formData.append('file', file, file.name);

    // Use XHR when available in browser/WebView to expose genuine upload progress events
    if (typeof XMLHttpRequest !== 'undefined' && onProgress) {
      return new Promise<BackendDocument>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
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
            onProgress(100);
            resolve(parsed as BackendDocument);
          } else {
            reject(new ApiError(parsed?.detail || `Upload failed (${xhr.status})`, xhr.status, parsed));
          }
        };
        xhr.onerror = () => reject(new ApiError('Network error during document upload.', 0));
        xhr.ontimeout = () => reject(new ApiError('Upload timed out. Check connection stability.', 0));
        xhr.send(formData);
      });
    }

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { method: 'POST', headers, body: formData });
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
    onProgress?.(100);
    return res.json();
  }

  public async downloadDocument(documentId: string): Promise<Blob> {
    const token = this.token || (await secureStorage.getToken());
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${this.getBaseUrl()}/documents/${encodeURIComponent(documentId)}/download`, {
      headers,
    });
    if (res.status === 401) {
      this.token = null;
      await secureStorage.clearAll();
      this.onSessionExpired?.('Session expired. Please sign in again.');
      throw new ApiError('Unauthorized', 401);
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(err?.detail || 'Document download failed', res.status);
    }
    return res.blob();
  }

  public async deleteDocument(documentId: string): Promise<any> {
    return this.requestJson(`/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  }

  // --- Cloud Projects ---

  public async listProjects(): Promise<CloudProjectSummary[]> {
    return this.requestJson('/projects');
  }

  public async getProject(projectId: string): Promise<CloudProjectDetail> {
    return this.requestJson(`/projects/${encodeURIComponent(projectId)}`);
  }

  public async createProject(payload: {
    client_id?: string;
    title: string;
    project_type: 'pdf' | 'docx' | 'slides' | 'sheets' | 'image' | 'ocr';
    data: any;
    tags?: string[];
    note?: string;
  }): Promise<CloudProjectDetail> {
    return this.requestJson('/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async updateProject(
    projectId: string,
    payload: { title?: string; data?: any; note?: string; expected_version?: number; force_overwrite?: boolean }
  ): Promise<CloudProjectDetail> {
    return this.requestJson(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  public async deleteProject(projectId: string): Promise<any> {
    return this.requestJson(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  }

  // --- Jobs & Tools ---

  public async listJobs(): Promise<BackendJob[]> {
    return this.requestJson('/jobs');
  }

  public async submitJob(title: string, objective: string, documentIds: string[], mode = 'hybrid'): Promise<BackendJob> {
    return this.requestJson('/jobs', {
      method: 'POST',
      body: JSON.stringify({ title, objective, document_ids: documentIds, mode }),
    });
  }

  public async approveJob(jobId: string, approved: boolean, rejectionReason?: string): Promise<BackendJob> {
    return this.requestJson(`/jobs/${encodeURIComponent(jobId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approved, rejection_reason: rejectionReason }),
    });
  }

  public async cancelJob(jobId: string): Promise<BackendJob> {
    return this.requestJson(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  }

  public async listTools(): Promise<any[]> {
    return this.requestJson('/tools');
  }

  public async invokeTool(toolName: string, args: Record<string, any>, idempotencyKey?: string): Promise<any> {
    return this.requestJson('/tools/invoke', {
      method: 'POST',
      body: JSON.stringify({
        tool_name: toolName,
        arguments: args,
        idempotency_key: idempotencyKey || `mob_${Date.now()}`,
      }),
    });
  }

  // --- AI & Local RAG ---

  public async listAgents(): Promise<any[]> {
    return this.requestJson('/agents');
  }

  public async executeAgent(prompt: string, documentIds: string[] = [], mode: 'single' | 'multi' | 'autonomous' = 'single'): Promise<any> {
    return this.requestJson('/agents/execute', {
      method: 'POST',
      body: JSON.stringify({ prompt, document_ids: documentIds, mode }),
    }, { timeoutMs: 60000 });
  }

  public async indexDocumentRag(documentId: string): Promise<{ document_id: string; chunks_indexed: number }> {
    return this.requestJson(`/local-ai/rag/index/${encodeURIComponent(documentId)}`, { method: 'POST' });
  }

  public async queryRag(question: string, documentIds: string[] = []): Promise<any> {
    return this.requestJson('/local-ai/rag/query', {
      method: 'POST',
      body: JSON.stringify({ question, document_ids: documentIds, top_k: 5 }),
    });
  }

  // --- Notifications, Announcements & Support Messages ---

  public async listNotifications(params: { category?: string; status?: 'all' | 'unread' | 'read'; limit?: number } = {}): Promise<NotificationListResponse> {
    const q = new URLSearchParams();
    if (params.category) q.set('category', params.category);
    if (params.status) q.set('status', params.status);
    if (params.limit) q.set('limit', String(params.limit));
    return this.requestJson(`/notifications?${q.toString()}`);
  }

  public async markNotificationRead(id: string): Promise<any> {
    return this.requestJson(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  }

  public async markAllNotificationsRead(): Promise<any> {
    return this.requestJson('/notifications/read-all', { method: 'POST' });
  }

  public async deleteNotification(id: string): Promise<any> {
    return this.requestJson(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  public async getNotificationPreferences(): Promise<NotificationPreferences> {
    return this.requestJson('/notifications/preferences');
  }

  public async updateNotificationPreferences(payload: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    return this.requestJson('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  public async getActiveAnnouncements(): Promise<{ items: any[] }> {
    return this.requestJson('/announcements/active');
  }

  public async dismissAnnouncement(id: string): Promise<any> {
    return this.requestJson(`/announcements/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
  }

  public async getInbox(): Promise<any> {
    return this.requestJson('/messages/inbox');
  }

  public async sendSupportMessage(subject: string, body: string, priority: 'normal' | 'important' | 'urgent' = 'normal'): Promise<any> {
    return this.requestJson('/messages/support/send', {
      method: 'POST',
      body: JSON.stringify({ subject, body, priority }),
    });
  }

  // --- Admin Console (Server-verified admin/superadmin only) ---

  public async getAdminTelemetry(): Promise<any> {
    return this.requestJson('/admin/telemetry');
  }

  public async getAdminUsers(search = ''): Promise<any[]> {
    const q = new URLSearchParams();
    if (search.trim()) q.set('search', search.trim());
    q.set('limit', '50');
    return this.requestJson(`/admin/users?${q.toString()}`);
  }

  public async suspendUser(userId: string, reason: string): Promise<any> {
    return this.requestJson(`/admin/users/${encodeURIComponent(userId)}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public async reactivateUser(userId: string): Promise<any> {
    return this.requestJson(`/admin/users/${encodeURIComponent(userId)}/reactivate`, { method: 'POST' });
  }

  public async getAdminUiConfig(): Promise<any> {
    return this.requestJson('/admin/ui-config');
  }

  public async updateAdminUiConfig(payload: {
    announcement_banner?: string;
    maintenance_mode?: boolean;
    maintenance_message?: string;
  }): Promise<any> {
    return this.requestJson('/admin/ui-config', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  public async getAdminAuditLogs(limit = 30): Promise<any[]> {
    return this.requestJson(`/admin/audit-logs?limit=${limit}`);
  }
}

export const apiClient = new OmniDocMobileApiClient();
