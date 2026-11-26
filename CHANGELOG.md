# Changelog — OmniDoc Studio Mobile

## [2.0.0] — Parity, Security & UX Release

### Security & Core Infrastructure
- **Resolved `pdfjs-dist` CVE (`GHSA-hq66-cqwq-w95j`):** Upgraded `pdfjs-dist` from `^5.3.31` to `^6.5.438` using `pdfjs-dist/legacy/build/pdf.mjs` and Vite-bundled `pdfjs-dist/legacy/build/pdf.worker.min.mjs` for full offline and `< Chrome 140` WebView compatibility.
- **Streaming Downloads & Request Hardening (`src/services/apiClient.ts`):** Added `res.body.getReader()` streaming progress and `AbortSignal` cancellation to `downloadDocument`, `AbortSignal` support to `uploadDocument`/`requestJson`/`getHealth`/`exportMyData`, `renameProject` (`PATCH /projects/{id}/rename`), in-flight mutation deduplication, and strict response shape validation.
- **Android Deep Links (`omnidoc://`):** Added `<intent-filter android:autoVerify="false">` for `omnidoc://` in `android/app/src/main/AndroidManifest.xml`, `appUrlOpen` parsing in `src/services/nativeBridge.ts` and `src/context/AuthContext.tsx`, and authenticated route handling in `src/App.tsx`.
- **Favicon Asset:** Added `public/favicon.svg` and `<link rel="icon">` in `index.html`, eliminating `/favicon.ico` 404 responses.

### New & Upgraded Document Studios
- **Word Studio (`src/screens/WordStudioScreen.tsx`, `src/engines/docxService.ts`):** Added full mobile Word Studio with XSS-safe `sanitizeHtml`, touch formatting toolbar, Find & Replace, live word/character counter, `.docx`/`.pdf`/`.txt`/`.html` export, and Cloud Project sync (`project_type: 'docx'`).
- **PowerPoint Studio (`src/screens/SlidesStudioScreen.tsx`, `src/engines/pptxService.ts`):** Added 16:9 mobile slide studio with horizontal slide strip, add/duplicate/reorder/delete, 6 theme presets, fullscreen touch/swipe presenter mode, `.pptx`/`.pdf` export, and Cloud Project sync (`project_type: 'slides'`).
- **Excel Sheets Studio (`src/screens/SheetsStudioScreen.tsx`, `src/engines/sheetService.ts`):** Added row/column/sheet creation and deletion, cell bold/alignment formatting persisted in Cloud Projects, and ASCII-safe formula-resolved PDF export.
- **PDF Studio (`src/screens/PdfStudioScreen.tsx`, `src/engines/pdfService.ts`):** Added zoom (`0.75x–2.25x`) with cancelable rendering, debounced in-PDF text search (`countTextOccurrencesInPdf`) with page jump chips, page reorder, duplicate page, insert blank page, `compressPdf`, and Visual Annotations & Overlays (notes, highlight, signature pad canvas, watermark, page numbers).
- **Conversion Studio (`src/screens/ConversionStudioScreen.tsx`, `src/engines/converter.ts`):** Added multi-file batch queue, upfront `getConversionCompatibilityReport` badges, Cancel/Retry controls, deduplicated `createBatchZipArchive` export, and Cloud `convert_document` execution.

### Navigation, UX & Library Upgrades
- **5-Tab Mobile Shell (`src/types/index.ts`, `src/components/MobileLayout.tsx`, `src/App.tsx`):** Aligned primary tabs to `Home`, `Convert`, `PDF`, `Docs`, and `Profile` with clean sub-view routing and hardware back-button support.
- **Library Preview & Project Management (`src/screens/LibraryScreen.tsx`):** Added inline Document Preview modal (images via object URL with cleanup, text/CSV/MD/HTML text preview, PDF/Office metadata + Digital Twin summary), live streaming download progress with Cancel, Cloud Project rename, and direct studio launch for `.docx`, `.pptx`, `.pdf`, `.xlsx`, and `.csv`.
- **Accessible Confirmation Dialog (`src/components/ConfirmDialog.tsx`):** Wired `role="alertdialog"` confirmations for all destructive actions across Library, PDF Studio, Profile, Settings, Admin Console, History, and Notifications.
- **Accessibility & UI Polish (`src/screens/AuthScreen.tsx`, `DashboardScreen.tsx`, `ProfileScreen.tsx`):** Added explicit `id`/`htmlFor`/`name`/`autoComplete` attributes, Account Hub consolidation, and zero mock data.

### Testing & Release Verification
- Expanded `src/tests/` to **4 files / 22 passing Vitest tests** including `@testing-library/react` UI component and RBAC guard tests (`src/tests/uiComponents.test.tsx`).
- Upgraded `scripts/run-backend-e2e.mjs` to **12 passing live FastAPI E2E checks** adding cross-user tenant isolation (`403`/`404`) and `PATCH /projects/{id}/rename` + `PUT /projects/{id}` + version history verification.
- Verified Android builds (`testDebugUnitTest` `2/2`, `app-debug.apk` `7.94 MB`, `app-release-unsigned.apk` `6.21 MB`, `app-release.aab` `5.61 MB`).
- Added comprehensive mobile documentation suite (`MOBILE_AUDIT_REPORT.md`, `MOBILE_ARCHITECTURE.md`, `MOBILE_API_INTEGRATION.md`, `MOBILE_FEATURE_PARITY.md`, `MOBILE_SECURITY_REPORT.md`, `MOBILE_TEST_REPORT.md`, `ANDROID_BUILD_GUIDE.md`, `DEPLOYMENT_GUIDE.md`, `CHANGELOG.md`).
