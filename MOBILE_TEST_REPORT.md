# OmniDoc Studio Mobile — Testing & Verification Report

**Target Repository:** `c:\Users\Dell\Documents\omnidoc-studio-mobile`  
**Shared Backend Reference:** `c:\Users\Dell\Documents\omnidoc-studio` (unmodified)

---

## 1. Automated Verification Summary

| Suite | Command | Scope | Observed Result |
| :--- | :--- | :--- | :--- |
| TypeScript Check | `npm run typecheck` (`tsc --noEmit`) | Strict type checking across `src/` | **PASS** (0 errors) |
| Production Web Bundle | `npm run build` (`tsc -b && vite build`) | 1,879 modules + local `pdf.worker.min-B5Yc7dP4.mjs` (`1,327.59 kB`) | **PASS** (`24.48s`) |
| Vitest Unit, Engine & UI Suite | `npm test` (`vitest run`) | 4 test files (`authAndSecurity`, `documentsAndNetwork`, `studiosEngines`, `uiComponents`) | **PASS (22/22 in 12.47s)** |
| Live FastAPI Backend E2E | `npm run e2e:backend` (`node scripts/run-backend-e2e.mjs`) | Unmodified `omnidoc-studio` FastAPI backend on port `18089` (temp SQLite + vault) | **PASS (12/12)** |
| Dependency Audit | `npm audit --omit=dev` | Production dependency tree | **0 `pdfjs-dist` advisories** (`3` upstream-only: `xlsx` ×2, `image-size` via `pptxgenjs`) |
| Capacitor Android Sync | `npx cap sync android` | Copies `dist/` to Android assets & syncs 9 plugins | **PASS (`5.695s`)** |
| Android Native JUnit | `.\gradlew.bat testDebugUnitTest` | `ExampleUnitTest` (1) + `SecureVaultLogicTest` (1) | **PASS (2/2)** |
| Android Debug APK | `.\gradlew.bat assembleDebug` | `android/app/build/outputs/apk/debug/app-debug.apk` | **PASS (`8,328,910` bytes / `7.94 MB`)** |
| Android Release APK | `.\gradlew.bat assembleRelease` | `android/app/build/outputs/apk/release/app-release-unsigned.apk` | **PASS (`6,508,722` bytes / `6.21 MB`)** |
| Android App Bundle (AAB) | `.\gradlew.bat bundleRelease` | `android/app/build/outputs/bundle/release/app-release.aab` | **PASS (`5,882,244` bytes / `5.61 MB`)** |

---

## 2. Vitest Suite Breakdown (4 Files, 22/22 Passed)

1. **`src/tests/authAndSecurity.test.ts` (7 tests)**
   - HTTPS enforcement for `staging`/`production`, protocol rejection, and local dev host (`10.0.2.2`, `localhost`, `127.0.0.1`) allowance.
   - `SecureVault` session save/read/clear lifecycle without `logout` leakage.
   - `isJwtExpired` skew boundary detection and malformed JWT rejection in `parseJwtPayload`.
   - Global `401` interception purging token + invoking `onSessionExpired`.
   - Automatic JWT rotation on `changePassword`.
   - Mandatory `2026.1` consent versions on `register`.
   - In-flight mutation deduplication (`runDedupedMutation`) + `renameProject` (`PATCH /projects/{id}/rename`) + empty title guard.

2. **`src/tests/documentsAndNetwork.test.ts` (6 tests)**
   - Magic-byte and structural validation for PDF, PNG, JPEG, WebP, DOCX, encrypted PDF (`/Encrypt`), spoofed PDF/DOCX, legacy OLE2 `.doc`, and max file size bounds.
   - Exponential-backoff GET retry recovery on transient HTTP `503`.
   - Clean `ApiError` surfacing on persistent network failures.
   - Streaming `downloadDocument(id, onProgress)` progress increments (`[50, 99, 100]`) and exact byte reassembly.
   - Pre-aborted and mid-stream `AbortSignal` cancellation + `401` purge during `downloadDocument`.
   - `offlineStore` persistence & complete isolation wipe on `clearUserCaches()` (documents, jobs, usage, entitlements, local history, sync timestamp).

3. **`src/tests/studiosEngines.test.ts` (5 tests)**
   - PDF engine: `mergePdfFiles`, `splitPdfByRange`, `rotatePdfPage`, `duplicatePdfPage`, `insertBlankPage`, `reorderPdfPages`, `deletePdfPage`, `compressPdf`, `applyPdfAnnotations`, and `countTextOccurrencesInPdf`.
   - Word engine: `sanitizeHtml` XSS stripping (`<script>`, `<iframe>`, `onclick`, `javascript:`), `htmlToDocxItems`, `createDocxBlob`, `extractTextFromDocxFile` round-trip, and `convertTextOrDocxToPdf`.
   - PowerPoint engine: `createPresentationBlob`, `extractTextFromPptxFile`, and `convertSlidesToPdf`.
   - Excel Sheets engine: `sanitizeWorkbookData` prototype-pollution defense, `evaluateCellFormula` (`=SUM`, `=AVERAGE`, `=MIN`, `=MAX`, `=COUNT`, `=IF`), `removeDuplicateRows`, `sortSheetRows`, `exportDataToXlsxBlob`, `parseSpreadsheetFile`, `exportDataToCsvBlob`, `convertSpreadsheetToPdf`.
   - Conversion & Batch engine: `executeFileConversion` (`TXT->PDF`, `CSV->XLSX`, `MD->HTML`, `AbortSignal` cancellation), `createBatchZipArchive` filename deduplication (`notes.pdf`, `notes_2.pdf`), and `getConversionCompatibilityReport`.

4. **`src/tests/uiComponents.test.tsx` (4 tests, `@testing-library/react`)**
   - `AuthScreen`: tab switching (`Sign In` / `Register` / `Reset`), consent checkboxes, `Admin Portal Sign-In` switch (`role="switch"`), and credential submission.
   - `ConfirmDialog`: `role="alertdialog"`, `aria-modal="true"`, confirm/cancel callbacks, `Escape` key dismissal, and `open={false}` unmount.
   - `MobileLayout`: 5-tab navigation (`Home`, `Convert`, `PDF`, `Docs`, `Profile`), active `aria-current="page"`, `onSelectTab`, `Offline` pill, unread badge, and `subView` back navigation.
   - `AdminScreen`: `403 Forbidden` guard blocking standard users with zero admin API calls, plus live telemetry rendering for server-verified `admin` users.

---

## 3. Live FastAPI Backend E2E Coverage (`scripts/run-backend-e2e.mjs` — 12/12 Passed)

1. `GET /health` liveness check.
2. `POST /api/v1/auth/register` (User A, `2026.1` consents).
3. `POST /api/v1/auth/login` (JWT + metadata).
4. `GET /api/v1/auth/me`, `/users/me/usage`, `/users/me/entitlements`.
5. `POST /api/v1/documents/upload`, `GET /api/v1/documents`, `GET /api/v1/documents/{id}/download` (byte-for-byte match).
6. **Cross-user / cross-tenant isolation:** User B registers in separate org and is blocked (`403`/`404`) from reading, downloading, or deleting User A's document, and omitted from `GET /documents`.
7. `POST /api/v1/jobs` & `GET /api/v1/jobs`.
8. **Cloud Projects lifecycle & isolation:** `POST /projects`, User B `403`/`404` isolation check, `PATCH /projects/{id}/rename` (`version: 1 -> 2`), stale `expected_version: 1` `409 Conflict` guard, `PUT /projects/{id}` (`version: 2 -> 3`), and `GET /projects/{id}/versions`.
9. `GET /api/v1/notifications` & `PUT /api/v1/notifications/preferences`.
10. Standard user RBAC check against `GET /api/v1/admin/telemetry` -> `403`.
11. `POST /api/v1/users/me/change-password` -> old JWT rejected (`401`), rotated JWT accepted (`200`).
12. Admin role promotion -> `POST /api/v1/admin/auth/login` + `GET /api/v1/admin/telemetry` (`200`), followed by `POST /api/v1/auth/logout` -> `/auth/me` returns `401`.

---

## 4. Emulator / Physical Device Verification Status

- Automated UI tests ran in `jsdom` (`@testing-library/react`). No physical Android handset or booted AVD emulator was attached during CLI verification, so interactive device/emulator smoke testing should be performed in Android Studio Device Manager using `app-debug.apk`.
