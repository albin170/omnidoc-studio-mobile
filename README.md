# OmniDoc Studio Mobile

Independent Android application (`v2.1.0`, `versionCode: 2`, App ID `studio.omnidoc.mobile`) for **OmniDoc Studio**, built with **React 19**, **TypeScript**, **Tailwind CSS v4**, **Capacitor 7**, and **Android Studio / Gradle**.

It connects directly to the shared **OmniDoc Studio FastAPI backend**, sharing the same PostgreSQL database, Supabase/S3 storage, user accounts, consents, workspaces, roles, permissions, plan entitlements, and audit trail.

---

## Key Capabilities (`v2.1.0`)

1. **Dashboard** — Shared storage quota gauge, document/job counters, plan tier badge, announcements, maintenance banner, and studio quick launchers.
2. **Document Library** — Search/filter vault files, sliced-hash duplicate detection with progress tracking & magic-byte validation, Digital Twin inspection, AI RAG indexing, encrypted per-user offline caching (WebCrypto AES-GCM + TTL), Cloud Projects versioning/rename, and 384 KB chunked native save/share (`Documents/OmniDoc/`).
3. **PDF Studio & Genuine Redaction** — Offline `pdfjs-dist` canvas viewer (bundled worker), merge, split, rotate/duplicate/reorder/blank/delete, zoom, search, compress, visual annotations/signature pad, multi-page camera scan, and **destructive `pako`-based PDF content-stream redaction** with binary + PDF.js verification.
4. **Word, PowerPoint & Excel Sheets Studios** — Touch-optimized editors with XSS-safe HTML sanitization (`docxService`), `@datalens-tech/xlsx@^0.20.3` sandboxed formulas & sheets (`sheetService`), patched `image-size` (`>=2.2.0`) widescreen PPTX slides (`pptxService`), and Cloud Project sync (`/projects`).
5. **Conversion Studio** — On-device and server-side `/tools/invoke` conversions across PDF, DOCX, PPTX, XLSX, CSV, PNG, JPG, WEBP, TXT, HTML, and MD with `device`/`cloud` fidelity badges, output magic-byte validation (`validateConversionOutput`), and deduplicated batch ZIP export.
6. **OCR & Image Studio** — On-device PDF text extraction + Cloud `extract_fields`/Digital Twin OCR with clear offline indicator, multi-page scan queue, `.txt`/`.docx` export, image compression/resizing, and PDF-to-PNG rendering.
7. **Team Workspaces** — Full 15-endpoint `/workspaces/*` integration: invitations inbox (accept/reject/invite), shared documents, role management, and team chat.
8. **Processing History, Profile, Settings & Notifications** — Autonomous DAG jobs (`/jobs`), encrypted local history, password rotation (JWT `token_version`), optional `ai_consent` audit history, verified App Links + one-time `/auth/mobile-code/exchange`, and developer API keys.
9. **Administrator Console** — Verified live against `GET /api/v1/admin/me` (`403` blocked otherwise), featuring telemetry, user search & suspend/reactivate, org subscription plan management, user entitlement overrides, global banners, and audit logs.

---

## Quick Start

```powershell
# 1. Install dependencies
npm install

# 2. Configure optional local environment overrides (never commit .env.local)
Copy-Item .env.example .env.local

# 3. Run typecheck, ESLint, Vitest unit/engine/UI tests, and audit
npm run typecheck
npm run lint
npm test
npm audit --omit=dev

# 4. Build web bundle & sync Capacitor Android project
npm run build
npx cap sync android
```

---

## Documentation Index

- [`MOBILE_AUDIT_REPORT.md`](MOBILE_AUDIT_REPORT.md) — Security remediation & production readiness audit
- [`MOBILE_SECURITY_REPORT.md`](MOBILE_SECURITY_REPORT.md) — Dependencies (`0` CVEs), `AndroidKeyStore`, AES-GCM cache, App Links, and PDF redaction security
- [`MOBILE_ARCHITECTURE.md`](MOBILE_ARCHITECTURE.md) — Capacitor 7 + React 19 + Android native topology
- [`MOBILE_API_INTEGRATION.md`](MOBILE_API_INTEGRATION.md) — Shared FastAPI endpoints, resilience & error sanitization
- [`MOBILE_FEATURE_PARITY.md`](MOBILE_FEATURE_PARITY.md) — Web vs. Mobile feature matrix
- [`MOBILE_TEST_REPORT.md`](MOBILE_TEST_REPORT.md) — Vitest (31/31), Backend E2E (16/16), Pytest, JUnit (4/4), and CI coverage
- [`ANDROID_BUILD_GUIDE.md`](ANDROID_BUILD_GUIDE.md) — Gradle CLI, JDK 21 setup & emulator guide
- [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) — Signed APK/AAB outputs (`apksigner` / `jarsigner`) & GitHub Actions workflows
- [`CHANGELOG.md`](CHANGELOG.md) — Release history (`2.0.0` -> `2.1.0`)
