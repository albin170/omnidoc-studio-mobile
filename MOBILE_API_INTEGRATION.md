# OmniDoc Studio Mobile — Shared Backend API Integration

The mobile client (`v2.1.0`) communicates directly with the shared **OmniDoc Studio FastAPI backend (`/api/v1`)** via `src/services/apiClient.ts` (`OmniDocMobileApiClient`). Both web and mobile clients share the same user accounts, roles, consents, tenant storage, workspaces, and entitlements.

---

## 1. Environment & URL Security (`src/config/env.ts`)

| Environment | Default Base URL | Transport Policy |
| :--- | :--- | :--- |
| `production` | `https://omnidoc-studio-jet.vercel.app/api/v1` | HTTPS strictly enforced |
| `staging` | Configured via `VITE_API_STAGING_URL` (defaults to prod URL) | HTTPS strictly enforced |
| `development` | `http://10.0.2.2:8000/api/v1` (Android Emulator host loopback) | HTTP allowed only for `10.0.2.2`, `localhost`, `127.0.0.1` |

`validateApiUrl()` validates syntax, enforces HTTPS outside local development loopbacks, and normalizes `/api/v1`.

---

## 2. Resilience, Deduplication & Error Sanitization (`src/services/apiClient.ts`)

- **Timeout & Abort Cleanup in `finally`:** `requestJson` wraps both `fetch()` AND full response consumption (`res.text()` / `res.json()`) inside the active timeout/abort guard, clearing timers and removing abort listeners inside `finally`.
- **Sliced Content Upload Fingerprinting:** `uploadDocument()` hashes 64 KB start/mid/end file slices + size + name (`computeFileIdentityKey`) to prevent false dedupe collisions across identically named uploads while supporting `{ allowDuplicate: true }`.
- **Content-Digested Project Deduplication:** `createProject()` and `updateProject()` include `computePayloadDigest()` in dedupe keys so rapid edits to the same project ID are never dropped.
- **User-Safe Error Sanitization:** `sanitizeUserErrorText()` normalizes HTTP `400/401/403/404/409/413/422/429/500+` responses without leaking raw SQL/stack details.
- **Global `401` Interception:** Clears `SecureVault`, purges active `offlineStore` cache, and redirects cleanly to `AuthScreen`.

---

## 3. Shared Endpoint Contract Table

| Domain | Mobile Methods | Backend Endpoints | Notes |
| :--- | :--- | :--- | :--- |
| Health | `getHealth` | `GET /api/v1/health` / `GET /health` | Unauthenticated liveness probe |
| Auth & Consents | `register`, `login`, `adminLogin`, `getMe`, `logout`, `forgotPassword`, `resetPassword`, `getConsentHistory`, `grantConsent`, `withdrawConsent` | `/api/v1/auth/*` | Registration preserves optional `ai_consent` (`false` by default in UI) and mandatory `2026.1` terms/privacy |
| Mobile Code Auth | `createMobileAuthCode`, `exchangeMobileAuthCode` | `POST /api/v1/auth/mobile-code`, `POST /api/v1/auth/mobile-code/exchange` | Single-use 60s code exchange + redirect allowlist |
| User Portal | `getEntitlements`, `getUsage`, `getSubscription`, `getUiConfig`, `updateProfile`, `changePassword`, `exportMyData`, `deleteAccount` | `/api/v1/users/me*` | `changePassword` rotates JWT (`token_version`) |
| Developer Keys | `getApiKeys`, `createApiKey`, `revokeApiKey` | `/api/v1/developer/keys*` | Scoped API key management |
| Documents | `listDocuments`, `getDocument`, `uploadDocument`, `downloadDocument`, `deleteDocument` | `/api/v1/documents*` | Streaming chunk download + sliced SHA-256 dedupe |
| Cloud Projects | `listProjects`, `getProject`, `createProject`, `updateProject`, `renameProject`, `deleteProject` | `/api/v1/projects*` | Optimistic locking (`expected_version` -> `409`) |
| Tools, OCR & Jobs | `listTools`, `invokeTool`, `listJobs`, `submitJob`, `approveJob`, `cancelJob` | `/api/v1/tools*`, `/api/v1/jobs*` | Drives Cloud conversions, `extract_fields` OCR, and DAG jobs |
| AI & RAG | `listAgents`, `executeAgent`, `indexDocumentRag`, `queryRag` | `/api/v1/agents*`, `/api/v1/local-ai/rag/*` | Respects user AI consent |
| Workspaces (15 APIs) | `listWorkspaces`, `createWorkspace`, `deleteWorkspace`, `listWorkspaceMembers`, `updateWorkspaceMemberRole`, `removeWorkspaceMember`, `listMyInvitations`, `inviteWorkspaceMember`, `acceptWorkspaceInvitation`, `rejectWorkspaceInvitation`, `listWorkspaceDocuments`, `shareDocumentToWorkspace`, `unshareWorkspaceDocument`, `downloadWorkspaceDocument`, `listWorkspaceMessages`, `postWorkspaceMessage`, `markWorkspaceMessagesRead` | `/api/v1/workspaces*` | Org-scoped RBAC & team chat |
| Notifications & Support | `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `deleteNotification`, `getNotificationPreferences`, `updateNotificationPreferences`, `getActiveAnnouncements`, `dismissAnnouncement`, `getInbox`, `sendSupportMessage` | `/api/v1/notifications*`, `/api/v1/announcements*`, `/api/v1/messages*` | Real-time unread count |
| Admin Console | `verifyAdminSession`, `getAdminTelemetry`, `getAdminUsers`, `suspendUser`, `reactivateUser`, `listAdminPlans`, `updateOrganizationSubscription`, `updateUserEntitlements`, `getAdminUiConfig`, `updateAdminUiConfig`, `getAdminAuditLogs` | `/api/v1/admin/*` | Server `/admin/me` verified (`403` blocked otherwise) |
