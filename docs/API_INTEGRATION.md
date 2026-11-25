# OmniDoc Studio Mobile — Shared Backend API Integration

The mobile app communicates exclusively with the existing OmniDoc Studio FastAPI backend (`API_V1_STR = /api/v1`). No secondary backend or database exists.

---

## 1. Environment Configuration

Configured via `src/config/env.ts` and `.env.example`:

| Environment | Default Base URL | Transport Policy |
| :--- | :--- | :--- |
| `production` | `https://omnidoc-studio-jet.vercel.app/api/v1` | HTTPS strictly enforced |
| `staging` | Configured via `VITE_API_STAGING_URL` | HTTPS strictly enforced |
| `development` | `http://10.0.2.2:8000/api/v1` (Android Emulator host loopback) | HTTP allowed only for `10.0.2.2`, `localhost`, `127.0.0.1` |

Runtime switching is available on the Login screen and inside **Account Settings**, persisted in `@capacitor/preferences` and validated by `validateApiUrl()`.

---

## 2. CORS & Native HTTP Strategy

The production FastAPI backend restricts browser `CORS_ORIGINS` to `http://localhost:5173`, `http://localhost:3000`, and `https://omnidoc-studio-jet.vercel.app`.

To connect cleanly **without modifying production backend CORS configuration**, `capacitor.config.ts` enables:

```ts
plugins: {
  CapacitorHttp: {
    enabled: true,
  },
}
```

Capacitor intercepts `fetch` / `XMLHttpRequest` inside the Android app and executes requests natively outside WebView CORS enforcement, while continuing to send `Authorization: Bearer <jwt>` and `Content-Type` headers identically to the web client.

---

## 3. Shared Endpoint Mapping

| Mobile Feature | Backend Endpoint | Auth / Notes |
| :--- | :--- | :--- |
| Health Check | `GET /api/v1/health` / `GET /health` | Unauthenticated |
| Registration | `POST /api/v1/auth/register` | Sends `terms_version`, `privacy_version`, `ai_consent_version` = `"2026.1"` |
| Standard Login | `POST /api/v1/auth/login` | Returns JWT + `user_id`, `org_id`, `role`, `plan_tier` |
| Admin Login | `POST /api/v1/admin/auth/login` | Enforces `role in ("admin", "superadmin")` server-side |
| Session Validation | `GET /api/v1/auth/me` | Run on cold boot & app resume |
| Logout | `POST /api/v1/auth/logout` | Blacklists `jti` in `revoked_tokens` |
| Password Reset | `POST /api/v1/auth/forgot-password`, `POST /api/v1/auth/reset-password` | 15-min hashed reset token |
| Usage & Quotas | `GET /api/v1/users/me/usage`, `GET /api/v1/users/me/entitlements` | Live org storage & plan features |
| UI Config | `GET /api/v1/users/me/ui-config` | Maintenance banner & announcements |
| Documents | `GET /api/v1/documents`, `POST /api/v1/documents/upload`, `GET /api/v1/documents/{id}/download`, `DELETE /api/v1/documents/{id}` | Multipart upload with XHR progress + magic-byte checks |
| Cloud Projects | `GET/POST /api/v1/projects`, `PUT/DELETE /api/v1/projects/{id}` | Syncs Sheets / Studio state across Web & Mobile |
| Tool Invocation | `GET /api/v1/tools`, `POST /api/v1/tools/invoke` | Backend `convert_document` & analysis tools |
| Jobs & History | `GET/POST /api/v1/jobs`, `POST /api/v1/jobs/{id}/approve`, `POST /api/v1/jobs/{id}/cancel` | Autonomous DAG workflows |
| AI & RAG | `POST /api/v1/local-ai/rag/index/{id}`, `POST /api/v1/local-ai/rag/query`, `POST /api/v1/agents/execute` | Grounded document Q&A & agent runs |
| Notifications | `GET /api/v1/notifications`, `PATCH /notifications/{id}/read`, `POST /notifications/read-all`, `PUT /notifications/preferences` | Category filtering & preference sync |
| Profile & GDPR | `PUT /api/v1/users/me`, `POST /api/v1/users/me/change-password`, `GET /api/v1/users/me/export`, `DELETE /api/v1/users/me` | Password change rotates JWT via `token_version` |
| Admin Console | `GET /api/v1/admin/telemetry`, `GET /api/v1/admin/users`, `POST /api/v1/admin/users/{id}/suspend\|reactivate`, `PATCH /api/v1/admin/ui-config`, `GET /api/v1/admin/audit-logs` | Admin/superadmin Bearer JWT required |

---

## 4. Resilience & Error Handling

- **Transient Retries**: Idempotent `GET` requests automatically retry up to 2 times with exponential backoff on network errors or HTTP `502`/`503`/`504`.
- **Timeouts**: Default `30s` request timeout (`VITE_API_TIMEOUT_MS`) and extended `120s` timeout for multipart document uploads.
- **Session Expiration**: Any HTTP `401` response clears `SecureVault`, nulls the in-memory token, wipes user-scoped caches, and returns the user to `AuthScreen` with an expiration notice.
