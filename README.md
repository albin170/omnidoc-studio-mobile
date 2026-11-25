# OmniDoc Studio Mobile

Independent Android mobile application for **OmniDoc Studio 2.0**, built with **React 19**, **TypeScript**, **Tailwind CSS v4**, **Capacitor 7**, and **Android Studio / Gradle**.

It connects directly to the existing **OmniDoc Studio FastAPI backend**, sharing the same PostgreSQL database, Supabase/S3 document storage, user accounts, roles, permissions, plan entitlements, and audit trail — with **zero modifications** to the original web repository.

---

## Key Capabilities

1. **Dashboard** — Shared vault storage quota, document/job counters, plan tier badge, global announcements, maintenance banner, and quick actions (Camera Scan -> PDF, Upload, Convert, Excel Sheets).
2. **Document Library** — Search/filter vault files, upload with progress tracking & magic-byte validation, camera scan directly to PDF, native Android save (`Documents/OmniDoc/`) & share sheet, Digital Twin inspection, AI RAG indexing, and Cloud Projects viewer.
3. **PDF Studio** — Offline-capable `pdfjs-dist` canvas viewer (local bundled worker), merge PDFs, split page ranges, rotate/delete pages, watermark & page numbering, text extraction, and multi-page camera scanning to PDF.
4. **Conversion Studio** — On-device conversions (offline-capable) and server-side backend conversions (`/tools/invoke`) across PDF, DOCX, PPTX, XLSX, CSV, PNG, JPG, WEBP, TXT, HTML, and MD with cancellation and progress tracking.
5. **Excel Sheets Studio** — Touch-optimized spreadsheet grid with sandbox-safe formula bar (`=SUM`, `=AVERAGE`, `=IF`, `=VLOOKUP`, etc.), multi-sheet tabs, row sorting & deduplication, Cloud Project sync (`/projects`), and `.xlsx` / `.csv` / `.pdf` export.
6. **Processing History** — Unified view of backend autonomous jobs (`/jobs` with human-in-the-loop approve/reject & cancel) and offline-cached local conversion/PDF history.
7. **User Profile** — View server identity/role/org, edit display name, change password (with automatic JWT rotation), view subscription status, and export GDPR SHA-256 user archive.
8. **Account Settings** — Switch API environments (`production` / `staging` / `development`), verify HTTPS endpoints, configure notification preferences, manage privacy consents, manage developer API keys, clear offline cache, or purge account.
9. **Notifications & Support** — Unread badge, category filters, mark read/all read, active announcements, and direct support messaging to administrators.
10. **Administrator Console** — Strictly gated to server-verified `admin` / `superadmin` accounts (`POST /api/v1/admin/auth/login`), offering platform telemetry, user search & suspend/reactivate, global banner/maintenance controls, and audit log inspection.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure optional local environment overrides (never commit .env.local)
cp .env.example .env.local

# 3. Run unit & engine tests
npm test

# 4. Build web bundle & sync Capacitor Android project
npm run cap:sync

# 5. Open in Android Studio or build APKs via Gradle
npx cap open android
```

---

## Repository Documentation

- [Architecture & Phase 1 Web Repo Inspection](docs/ARCHITECTURE.md)
- [Shared Backend API Integration](docs/API_INTEGRATION.md)
- [Android Build & Emulator Guide](docs/ANDROID_BUILD.md)
- [Security & Keystore Vault Design](docs/SECURITY.md)
- [Testing & Verification Report](docs/TESTING.md)
- [Release & Signing Guide](docs/RELEASE.md)
