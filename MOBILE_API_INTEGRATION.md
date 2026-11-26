# OmniDoc Studio Mobile — Shared Backend API Integration

The mobile client communicates exclusively with the unmodified OmniDoc Studio FastAPI backend (`/api/v1`) via `src/services/apiClient.ts` (`OmniDocMobileApiClient`). No secondary backend or database exists.

---

## 1. Environment & URL Security (`src/config/env.ts`)

| Environment | Default Base URL | Transport Policy |
| :--- | :--- | :--- |
| `production` | `https://omnidoc-studio-jet.vercel.app/api/v1` | HTTPS strictly enforced |
| `staging` | Configured via `VITE_API_STAGING_URL` (defaults to prod URL) | HTTPS strictly enforced |
| `development` | `http://10.0.2.2:8000/api/v1` (Android Emulator host loopback) | HTTP allowed only for `10.0.2.2`, `localhost`, `127.0.0.1` |

`validateApiUrl(url, env)` validates URL syntax, enforces `https:` for `staging` and `production`, rejects unsupported protocols (`ftp:`, etc.), and normalizes the `/api/v1` suffix. Configurations persist via `@capacitor/preferences`.

---

## 2. Native HTTP & CORS Compatibility (`capacitor.config.ts`)

```ts
plugins: {
  CapacitorHttp: {
    enabled: true,
  },
}
```

With `CapacitorHttp` enabled, Capacitor intercepts `fetch` / `XMLHttpRequest` calls inside the Android runtime and executes them in native Android networking rather than WebView CORS preflight, enabling direct compatibility with the shared production backend without altering server `CORS_ORIGINS`.

---

## 3. Hardened Client Features (`src/services/apiClient.ts`)

- **Streaming Downloads with Progress & Cancellation:** `downloadDocument(documentId, onProgress?, signal?)` reads `res.body.getReader()` chunk-by-chunk, computes exact percentage from `Content-Length` (clamped `0..99` mid-stream, `100` on completion, with smooth fallback estimation when `Content-Length` is absent), supports `AbortSignal`, and cancels the underlying reader cleanly on abort or timeout.
- **Upload Progress & Cancellation:** `uploadDocument(file, onProgress?, signal?)` uses `XMLHttpRequest` upload progress events in WebView/browser contexts and `fetch` fallback otherwise, with `AbortSignal` support and `120s` minimum upload timeout.
- **In-Flight Mutation Deduplication:** `runDedupedMutation(key, fn)` coalesces accidental double-taps on login, registration, logout, profile updates, project creation/updates/renames, deletes, and job actions.
- **Strict Response Shape Validation:** `validateTokenResponse`, `validateDocumentShape`, `validateProjectSummaryShape`, `validateProjectDetailShape`, `validateBackendJobShape`, and `validateNotificationListShape` reject malformed payloads with `ApiError(..., 502)`.
- **Transient Retry Policy:** Idempotent `GET` requests retry up to 2 times with exponential backoff on network errors or HTTP `502`, `503`, `504`.
- **Global 401 Interception:** Any `401` on authenticated calls nulls `this.token`, calls `secureStorage.clearAll()`, and invokes `onSessionExpired` to wipe `offlineStore` and return to `AuthScreen`.

---

## 4. Shared Endpoint Contract Table

| Domain | Mobile Method | Backend Endpoint | Notes |
| :--- | :--- | :--- | :--- |
| Health | `getHealth(customBaseUrl?, signal?)` | `GET /api/v1/health` (fallback `GET /health`) | Unauthenticated |
| Registration | `register(payload, signal?)` | `POST /api/v1/auth/register` | Enforces `terms_version`, `privacy_version`, `ai_consent_version` (`"2026.1"`) |
| Standard Login | `login(email, password, signal?)` | `POST /api/v1/auth/login` | Returns `access_token`, `user_id`, `org_id`, `role`, `plan_tier` |
| Admin Login | `adminLogin(email, password, signal?)` | `POST /api/v1/admin/auth/login` | Server enforces `role in ("admin", "superadmin")` |
| Session & Consent | `getMe`, `logout`, `forgotPassword`, `resetPassword`, `getConsentHistory`, `grantConsent`, `withdrawConsent` | `/api/v1/auth/*` | `logout` blacklists `jti` server-side |
| User Portal | `getEntitlements`, `getUsage`, `getSubscription`, `getUiConfig`, `updateProfile`, `changePassword`, `exportMyData`, `deleteAccount` | `/api/v1/users/me*` | `changePassword` rotates JWT (`token_version`) |
| Developer Keys | `getApiKeys`, `createApiKey`, `revokeApiKey` | `/api/v1/developer/keys*` | Scoped API key lifecycle |
| Documents | `listDocuments`, `getDocument`, `uploadDocument`, `downloadDocument`, `deleteDocument` | `/api/v1/documents*` | Tenant-isolated via org RLS + magic-byte validation |
| Cloud Projects | `listProjects`, `getProject`, `createProject`, `updateProject`, `renameProject`, `deleteProject` | `/api/v1/projects*`, `PATCH /api/v1/projects/{id}/rename` | Supports optimistic concurrency (`expected_version` -> `409 VERSION_CONFLICT`) |
| Tools & Jobs | `listTools`, `invokeTool`, `listJobs`, `submitJob`, `approveJob`, `cancelJob` | `/api/v1/tools*`, `/api/v1/jobs*` | Includes `convert_document` & DAG approvals |
| AI & RAG | `listAgents`, `executeAgent`, `indexDocumentRag`, `queryRag` | `/api/v1/agents*`, `/api/v1/local-ai/rag/*` | Respects user AI processing consent |
| Notifications & Support | `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `deleteNotification`, `getNotificationPreferences`, `updateNotificationPreferences`, `getActiveAnnouncements`, `dismissAnnouncement`, `getInbox`, `sendSupportMessage` | `/api/v1/notifications*`, `/api/v1/announcements*`, `/api/v1/messages*` | Real-time unread count & preferences |
| Admin Console | `getAdminTelemetry`, `getAdminUsers`, `suspendUser`, `reactivateUser`, `getAdminUiConfig`, `updateAdminUiConfig`, `getAdminAuditLogs` | `/api/v1/admin/*` | Server-verified admin/superadmin only (`403` otherwise) |
