# OmniDoc Studio Mobile — Testing & Verification Report

**Target Repository:** `c:\Users\Dell\Documents\omnidoc-studio-mobile` (`v2.1.0`, `versionCode: 2`)  
**Shared Backend Reference:** `c:\Users\Dell\Documents\omnidoc-studio`

---

## 1. Automated Verification Summary

| Suite / Artifact | Command | Scope | Observed Result |
| :--- | :--- | :--- | :--- |
| TypeScript Check | `npm run typecheck` (`tsc --noEmit`) | Strict type checking across `src/` | **PASS** (0 errors) |
| ESLint Check | `npm run lint` (`eslint src`) | ESLint 9 + `typescript-eslint` across `src/` | **PASS** (0 errors; 217 `@typescript-eslint/no-explicit-any` warnings) |
| Vitest Unit, Engine & UI Suite | `npm test` (`vitest run`) | 4 test files (`authAndSecurity`, `documentsAndNetwork`, `studiosEngines`, `uiComponents`) | **PASS (31/31 tests across 4 files)** |
| Production Web Bundle | `npm run build` (`tsc -b && vite build`) | 1,932 modules + local `pdf.worker.min-B5Yc7dP4.mjs` (`1,327.59 kB`) | **PASS** |
| Dependency Security Audit | `npm audit --omit=dev` (and `npm audit`) | Full npm production/dev dependency trees | **PASS (0 vulnerabilities)** |
| Live FastAPI Backend E2E | `npm run e2e:backend` (`node scripts/run-backend-e2e.mjs`) | Real `omnidoc-studio` FastAPI uvicorn backend on port `18089` | **PASS (16/16 checks)** |
| Backend Auth & Consent Pytest | `pytest tests/test_ai_consent_and_mobile_code.py tests/test_auth_and_isolation.py tests/test_auth_regression_suite.py -v` | AI consent registration (`True`/`False`), mandatory Terms/Privacy `422`, mobile auth code exchange/replay/redirect, org isolation | **PASS (4/4)** |
| Backend PG/Storage Pytest | `pytest tests/test_postgres_and_storage_integration.py tests/test_supabase_storage.py -v` | Portable async DB isolation (`TEST_DATABASE_URL` / SQLite fallback), consent history, project versioning, `StorageVaultService`, `SupabaseStorageAdapter` | **PASS (5/5)** |
| Capacitor Android Sync | `npx cap sync android` | Syncs `dist/` assets & 9 Capacitor Android plugins | **PASS (`0.606s`)** |
| Android JVM Unit Tests | `.\gradlew.bat --no-daemon testDebugUnitTest` | `ExampleUnitTest` (1) + `SecureVaultLogicTest` (3) | **PASS (4/4, 0 failures, 0 skipped)** |
| Android Instrumented APK Build | `.\gradlew.bat --no-daemon assembleDebugAndroidTest` | `MainActivityInstrumentedTest` (2) + `ExampleInstrumentedTest` (1) packaged | **PASS (`app-debug-androidTest.apk`, `563,768` bytes)** |
| Android Debug APK | `.\gradlew.bat --no-daemon assembleDebug` | `android/app/build/outputs/apk/debug/app-debug.apk` | **PASS (`8,208,368` bytes / `7.83 MB`)** |
| Signed Android Release APK | `.\gradlew.bat --no-daemon assembleRelease` + `apksigner verify` | `android/app/build/outputs/apk/release/app-release.apk` | **PASS (`6,656,312` bytes / `6.35 MB`; `Verifies`, v1+v2 signed)** |
| Signed Android App Bundle (AAB) | `.\gradlew.bat --no-daemon bundleRelease` + `jarsigner -verify` | `android/app/build/outputs/bundle/release/app-release.aab` | **PASS (`5,999,438` bytes / `5.72 MB`; `jar verified.`)** |

---

## 2. Vitest Suite Breakdown (4 Files, 31/31 Passed)

1. **`src/tests/authAndSecurity.test.ts` (8 tests):** HTTPS URL enforcement & loopback rules, `SecureVault` session lifecycle, strict JWT structure & fail-closed `exp` validation, global `401` session wipe, automatic JWT rotation on `changePassword`, explicit `2026.1` AI consent opt-out/opt-in payloads, deep-link route allowlist & embedded-token rejection (`parseDeepLinkUrl`), and mutation deduplication / `renameProject`.
2. **`src/tests/documentsAndNetwork.test.ts` (11 tests):** Magic-byte & structure validation (PDF `/Encrypt`, OLE2 `.doc`, spoofed containers, limits), exponential-backoff GET retry recovery (`503`), clean `ApiError` sanitization, streaming `downloadDocument` progress & exact byte reassembly, mid-stream/pre-abort `AbortSignal`, `401` abort wipe, distinct payload project update dedupe, sliced 64 KB SHA-256 upload fingerprint, encrypted per-user `offlineStore` isolation/TTL/tamper recovery, and 1 MB chunked native save/cancellation.
3. **`src/tests/studiosEngines.test.ts` (7 tests):** PDF merge/split/rotate/delete/duplicate/insertBlank/reorder/compress/annotations/search, **genuine destructive PDF content-stream redaction (`status === 'Verified'`, `residualTextFound === false`, absent from PDF.js text & Latin-1 bytes)**, malformed XLSX/PPTX & 25 MB size caps with `@datalens-tech/xlsx` + `pptxgenjs`, `sanitizeHtml` XSS defenses & DOCX round-trip, spreadsheet formulas/sort/dedup, batch conversion/ZIP deduplication + magic-byte output validation (`validateConversionOutput`).
4. **`src/tests/uiComponents.test.tsx` (5 tests):** `AuthScreen` tabs & default unchecked optional consents, `ConfirmDialog` accessibility (`role="alertdialog"`, `Escape`), `MobileLayout` 5-tab shell, **`AdminScreen` server `/admin/me` `403` block even with locally spoofed user role**, and **`WorkspacesScreen` role permissions & tab flows**.

---

## 3. Live FastAPI Backend E2E Coverage (`scripts/run-backend-e2e.mjs` — 16/16 Passed)

1–12. Health check, User A register/login, profile/usage/entitlements, document upload/list/download integrity, User B cross-tenant `403`/`404` isolation, jobs lifecycle, cloud project create/rename (`PATCH`)/stale `expected_version` `409`/update (`PUT`)/versions, notifications & preferences, non-admin `/admin/telemetry` `403`, password change JWT rotation, admin portal login + telemetry, and logout JWT revocation (`401`).  
13. **AI Consent Opt-Out & Audit History:** Registers `ai_consent: false` user and confirms `/auth/me` + `/auth/consent/history` preserve `ai_processing: false` while `terms_and_conditions` is `true`.  
14. **Mobile One-Time Auth Code Exchange:** Creates opaque single-use code via `/auth/mobile-code`, exchanges via `/auth/mobile-code/exchange`, verifies replay returns `400`, and verifies untrusted `redirect_uri` returns `400`.  
15. **Workspace Collaboration & Cross-Org Isolation:** Creates workspace, uploads & shares document, posts workspace message, and asserts cross-org `tokenB` receives `403` on `/workspaces/{id}/members` and `/workspaces/{id}/documents`.  
16. **Tools Catalog & Local-AI RAG Index:** Verifies `/tools` listing and `/local-ai/rag/index/{doc_id}` indexing.

---

## 4. Android & PostgreSQL Runtime Verification Scope (Local vs. GitHub CI)

- **Local Workstation Verification:** Runs real JVM JUnit tests (`4/4` passing including 3 `SecureVaultCrypto` AES-256-GCM tests), full `assembleDebugAndroidTest` instrumentation APK packaging, signed release APK/AAB cryptographic verification (`apksigner` & `jarsigner`), and SQLite + `StorageVaultService` + mocked `SupabaseStorageAdapter` pytest suites.
- **Explicit Local Tooling Limitations:** Neither an Android Emulator AVD system image (`emulator -list-avds` empty) nor a local PostgreSQL server (`psql`/Docker absent) is installed on the local Windows workstation.
- **CI Coverage:** `.github/workflows/mobile-ci.yml` executes `test_postgres_and_storage_integration.py` against a live `postgres:16-alpine` service container (`postgresql+asyncpg`), and `.github/workflows/android-build.yml` executes `./gradlew --no-daemon connectedDebugAndroidTest` (`MainActivityInstrumentedTest` + `ExampleInstrumentedTest`) on `reactivecircus/android-emulator-runner@v2` (API 34).
