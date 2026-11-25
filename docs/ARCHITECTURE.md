# OmniDoc Studio Mobile — Architecture & Phase 1 Inspection Report

## 1. Phase 1 Inspection Summary of `albin170/omnidoc-studio`

Before designing `omnidoc-studio-mobile`, the existing production repository (`https://github.com/albin170/omnidoc-studio`, commit `549d1f1`) was inspected across frontend, backend, database, storage, and security layers:

### 1.1 Existing System Topology
- **Web Frontend**: React 19 + TypeScript + Vite 8 + Tailwind CSS v4 (`src/App.tsx`, `src/sdk/omnidocClient.ts`, `src/services/*`). Deployed on Vercel (`https://omnidoc-studio-jet.vercel.app`).
- **Backend API**: FastAPI (`backend/app/main.py`, `api/index.py` serverless entrypoint) exposing `/api/v1/*` routers and `/health`, `/healthz`, `/api/v1/ready`, `/api/v1/health`.
- **Database**: SQLAlchemy Async (`postgresql+asyncpg` via Supabase pooler in production; `sqlite+aiosqlite` in local dev) with Alembic migrations and Row-Level Security (`app/core/rls.py`, `app/core/tenancy.py`).
- **Object Storage**: Tenant-isolated `StorageVault` (`backend/app/services/storage.py`) supporting Supabase Storage (`{org_id}/{doc_id}/{filename}`), S3/R2, or local `./storage_vault` in development.
- **Authentication & Authorization**:
  - `HS256` JWT tokens (`backend/app/core/security.py`, 24h expiration by default) containing `sub`, `org_id`, `role`, `plan_tier`, `token_version`, and `jti`.
  - Revocation enforced server-side via `RevokedToken` JTI blacklist on `POST /auth/logout` and `token_version` increment on password change/reset.
  - Registration (`POST /auth/register`) provisions an `Organization`, `User` (`role="user"`), and 4 immutable `ConsentRecord` entries requiring `2026.1` policy versions.
  - Roles: `superadmin`, `admin`, `staff`, `user`, `auditor`. Admin Portal authentication uses dedicated `POST /api/v1/admin/auth/login` (and `/auth/admin/login`) rejecting non-admins with `403`.
- **Core Capabilities**:
  - **Documents**: `/documents/upload` (magic-byte + zip-bomb validation + org row lock quota check + Digital Twin parsing), `/documents`, `/documents/{id}`, `/documents/{id}/download` (Bearer or HMAC signed URL), `DELETE /documents/{id}`.
  - **PDF Studio**: Client-side `pdf-lib` + `pdfjs-dist` (`src/services/pdfService.ts`, `pdfSanitizerService.ts`) for merge, split, rotate, delete, reorder, annotations, watermarks, text extraction, and stream redaction.
  - **Conversion Studio**: Client-side `src/services/converter.ts` (11 formats: `pdf, docx, pptx, xlsx, csv, png, jpg, webp, txt, html, md`) plus backend `POST /tools/invoke` (`convert_document`, `inspect_file`, `parse_document`, `extract_fields`, `compare_documents`, `edit_document`, `generate_report`).
  - **Excel Sheets**: `src/services/sheetService.ts` using `xlsx` + `pdf-lib` with a sandboxed recursive-descent formula evaluator (`SUM`, `AVERAGE`, `IF`, `VLOOKUP`, `XLOOKUP`, `SUMIF`, etc.) and CSV/XLSX/PDF export.
  - **Cloud Projects & Collaboration**: `/projects` with optimistic concurrency (`expected_version`, HTTP `409 VERSION_CONFLICT`) and version snapshots; `/workspaces` for team collaboration.
  - **AI & Workflows**: `/jobs` (DAG autonomous plans with `awaiting_approval` human gates), `/agents/execute`, and `/local-ai/rag/*` for document indexing and Q&A.
  - **User Settings & Notifications**: `/users/me*` (profile, password change, entitlements, usage, subscription, UI config, GDPR export, account purge), `/notifications*`, `/announcements/active`, `/messages/*`, `/developer/keys`.
  - **Admin Console**: `/admin/telemetry`, `/admin/users*` (create/update/suspend/reactivate/entitlements), `/admin/plans*`, `/admin/ui-config`, `/admin/audit-logs`.

### 1.2 Why a Separate Mobile Repository Was Required
1. The desktop web app uses fixed multi-panel desktop layouts, `localStorage` for JWT tokens, and an external CDN URL for `pdfjs-dist` worker (`cdnjs.cloudflare.com`), which fails offline on Android.
2. Wrapping the desktop UI directly in a WebView breaks touch ergonomics, hardware back-button navigation, camera scanning, Android Keystore token encryption, and native share/save flows.
3. Keeping `omnidoc-studio-mobile` in its own repository guarantees zero risk to the production Vercel deployment, backend, database, and web CI/CD.

---

## 2. Mobile Application Architecture

```
+-------------------------------------------------------------------+
|                   Android App (Capacitor 7)                       |
|  appId: studio.omnidoc.mobile  |  androidScheme: https            |
+-------------------------------------------------------------------+
|  React 19 + TypeScript + Tailwind CSS v4 Mobile UI                |
|  Bottom Tabs: Home | Library | Studios | Activity | More          |
+-------------------------------+-----------------------------------+
|  Client Document Engines      |  Services & Security              |
|  - pdfService (local worker)  |  - apiClient (shared FastAPI)     |
|  - sheetService (formulas)    |  - secureStorage -> SecureVault   |
|  - converter (11 formats)     |  - offlineStore (Preferences)     |
|  - fileValidator (magic bytes)|  - nativeBridge (Camera/FS/Share) |
+-------------------------------+-----------------------------------+
|  Native Android Layer                                             |
|  - SecureVaultPlugin.java (AndroidKeyStore AES-256-GCM)           |
|  - CapacitorHttp (native HTTP stack -> bypasses WebView CORS)     |
|  - network_security_config.xml (HTTPS enforced; dev-only HTTP)    |
+-------------------------------------------------------------------+
                                |
                                | HTTPS + Bearer JWT
                                v
+-------------------------------------------------------------------+
|        Existing Shared OmniDoc Studio Backend (Unchanged)         |
|   https://omnidoc-studio-jet.vercel.app/api/v1                    |
|   PostgreSQL (Supabase + RLS)  |  Object Storage Vault            |
+-------------------------------------------------------------------+
```

### 2.1 Shared Backend Guarantee
- **Single Source of Truth**: Mobile users authenticate against the exact same `/api/v1/auth/*` and `/api/v1/admin/auth/login` endpoints.
- **Same IDs & Roles**: `user_id`, `org_id`, `role`, `plan_tier`, document ownership, and quotas come directly from the shared PostgreSQL database.
- **Zero CORS Modification Required**: By enabling `CapacitorHttp: { enabled: true }` in `capacitor.config.ts`, API calls from the Android app execute in the native `HttpURLConnection` / OkHttp layer rather than the Chromium WebView CORS sandbox, allowing immediate compatibility with the untouched production backend.

### 2.2 Offline & Mobile-First Adaptation
- **Bundled PDF.js Worker**: `pdfService.ts` resolves `pdfjs-dist/build/pdf.worker.min.mjs` via Vite `import.meta.url` so PDF rendering, merging, splitting, rotating, watermarking, and camera-scan-to-PDF work with zero internet access.
- **Offline Metadata & History Cache**: `offlineStore.ts` caches document metadata, jobs, usage metrics, entitlements, and local processing history in `@capacitor/preferences`, wiping all user data on logout or session expiration.
