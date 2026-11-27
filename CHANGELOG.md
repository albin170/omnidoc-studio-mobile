# Changelog — OmniDoc Studio Mobile

## [2.2.0] — Android R8 Release, iOS Platform & GitHub Release Automation (`versionCode: 3`)

### Android Production Build & R8 Minification
- Enabled R8 code shrinking (`minifyEnabled true`) and resource shrinking (`shrinkResources true`) in `android/app/build.gradle` with Capacitor 7 & `SecureVaultPlugin` keep rules in `android/app/proguard-rules.pro`, reducing signed `omnidoc-studio-v2.2.0.apk` to **`3,271,703` bytes (`3.12 MB`)** and `omnidoc-studio-v2.2.0.aab` to **`4,076,727` bytes (`3.89 MB`)**.
- Verified signatures via `apksigner` (`v1 + v2`) and `jarsigner`, generated real artifact checksums (`SHA256SUMS.txt` & `release-manifest.json`), and bumped `versionCode 3` / `versionName "2.2.0"`.

### iOS Capacitor Platform & Apple Keychain Bridge
- Added `@capacitor/ios@^7.4.4` and native Xcode workspace (`ios/App/`), configured `Info.plist` privacy usage descriptions, file sharing, `omnidoc://` URL scheme, Associated Domains (`applinks:omnidoc-studio-jet.vercel.app`), `1024x1024` opaque `AppIcon`, and implemented `SecureVaultPlugin.swift` + `OmniDocBridgeViewController.swift` using Apple Security Keychain.
- Updated `src/services/secureStorage.ts` to support `'ios_keychain'` alongside `'android_keystore'` and `'web_session'` (Vitest expanded to **32/32**).
- Documented exact Apple Developer signing requirements in [`IOS_DEPLOYMENT_GUIDE.md`](IOS_DEPLOYMENT_GUIDE.md).

### Automated Release Pipelines
- Added [`.github/workflows/release-android.yml`](.github/workflows/release-android.yml) (version validation, quality gates, secret-backed keystore signing, `apksigner`/`jarsigner` checks, `SHA256SUMS.txt` + `release-manifest.json`, GitHub Release upload, post-release asset reachability check, and Download Center dispatch).
- Added [`.github/workflows/release-ios.yml`](.github/workflows/release-ios.yml) (`macos-14` iOS Simulator check + conditional signed archive/IPA export when Apple secrets are present).

## [2.1.0] — Security Remediation, Integrity, Workspaces & Release Readiness (`versionCode: 2`)

### Critical Security Remediations
- **Resolved High/Critical Dependency Advisories (`npm audit` -> 0 vulnerabilities):** Replaced `xlsx@0.18.5` with `@datalens-tech/xlsx@^0.20.3`, added `"overrides": { "image-size": "^2.2.0" }`, added `pako@^2.1.0` + `@types/pako`, ESLint 9 (`eslint.config.js`), and upgraded Vitest (`^5.1.2`).
- **Fixed Backend AI Consent Opt-Out (`omnidoc-studio/backend/app/api/v1/auth.py`):** Registration now accurately stores optional `ai_consent` (`false` by default in `AuthScreen.tsx`) rather than forcing `granted=True`, while still rejecting missing mandatory Terms/Privacy with HTTP `422`.
- **Replaced Token-in-URL Deep Links with Verified App Links & One-Time Code Exchange:** Added `<intent-filter android:autoVerify="true">` for `https://omnidoc-studio-jet.vercel.app/mobile` in `AndroidManifest.xml`, strict `parseDeepLinkUrl()` route allowlist and embedded-token rejection in `nativeBridge.ts`, and backend single-use `/api/v1/auth/mobile-code` + `/api/v1/auth/mobile-code/exchange` endpoints.
- **Hardened JWT & Android Keystore Lifecycles (`secureStorage.ts`, `SecureVaultCrypto.java`, `SecureVaultPlugin.java`):** Enforced JWT structure + fail-closed `exp` validation, added hardware `KeyInfo` reporting and automatic corrupted/invalidated key recovery, and added auxiliary WebCrypto key storage.
- **Encrypted User-Scoped Offline Store (`src/services/offlineStore.ts`):** Documents, jobs, usage, entitlements, and processing history are now encrypted per SHA-256-hashed user namespace with WebCrypto AES-GCM 256-bit keys, TTL expiration, and tamper fail-closed recovery.

### Genuine Engines, Memory Streaming & Reliability
- **Genuine Destructive PDF Content Redaction (`src/engines/pdfRedactionService.ts`, `PdfStudioScreen.tsx`):** Added real `FlateDecode` / Form XObject decompression, literal/escaped/hex + `TJ` kerning array scrubbing, metadata/annotation removal, raster/AcroForm warnings, and post-save binary + PDF.js extraction verification.
- **API Client Hardening (`src/services/apiClient.ts`):** Fixed early timer/abort cleanup before body read completion, added `computePayloadDigest` to project dedupe keys, added sliced 64 KB SHA-256 `computeFileIdentityKey` on uploads, and sanitized backend error text.
- **Chunked Native Streaming & Memory Safety (`src/services/nativeBridge.ts`, `LibraryScreen.tsx`, `pdfService.ts`, `imageService.ts`):** Switched `saveFileToDevice` & `shareDocumentFile` to 384 KB Base64 chunks with abort partial-file cleanup and `OmniDocShare` purge, URI-first camera captures, canvas buffer zeroing in `finally`, and fixed Digital Twin `PAGES` `[object Object]` display.
- **Conversion Output Validation (`src/engines/converter.ts`, `ConversionStudioScreen.tsx`):** Added ZIP `PK\x03\x04` and magic-byte output validation (`validateConversionOutput`) plus `device` vs `cloud` fidelity badges.

### New Mobile Capabilities
- **OCR & Image Studio (`src/screens/OcrImageStudioScreen.tsx`, `src/engines/ocrService.ts`, `src/engines/imageService.ts`):** Added on-device PDF text + Cloud `/tools/invoke` `extract_fields` / Digital Twin OCR workflow with multi-page scan queue, `.txt`/`.docx` export, image compression/resizing, and PDF-to-PNG rendering.
- **Team Workspaces (`src/screens/WorkspacesScreen.tsx`, `apiClient.ts`):** Added full 15-endpoint `/workspaces/*` integration (pending invitations, shared documents, members/roles, team chat).
- **Server-Verified Admin Portal & Entitlement Controls (`src/screens/AdminScreen.tsx`):** Enforced live `GET /api/v1/admin/me` verification on mount plus organization plan selector and user entitlement overrides.

### Testing, CI/CD & Signed Release Verification
- Added `.github/workflows/mobile-ci.yml` (`postgres:16-alpine` integration + frontend security/lint/test/build) and `.github/workflows/android-build.yml` (`reactivecircus/android-emulator-runner@v2` API 34 instrumentation tests).
- Expanded Vitest to **31/31** passing tests (4 files), live FastAPI E2E to **16/16** checks (`scripts/run-backend-e2e.mjs`), backend PG/storage integration to **5/5** pytest cases, backend auth/consent to **4/4**, and Android JVM unit tests to **4/4** (`ExampleUnitTest` + 3 `SecureVaultLogicTest` crypto tests).
- Fixed Kotlin transitive stdlib duplicate class alignment (`1.8.22` in `android/build.gradle`), added `MainActivityInstrumentedTest.java`, and generated & cryptographically verified signed `app-release.apk` (`6,656,312` bytes, `apksigner` v1+v2 verified) and `app-release.aab` (`5,999,438` bytes, `jarsigner` verified).

---

## [2.0.0] — Parity, Security & UX Release

### Security & Core Infrastructure
- **Resolved `pdfjs-dist` CVE (`GHSA-hq66-cqwq-w95j`):** Upgraded `pdfjs-dist` from `^5.3.31` to `^6.5.438` using `pdfjs-dist/legacy/build/pdf.mjs` and Vite-bundled `pdfjs-dist/legacy/build/pdf.worker.min.mjs`.
- **Streaming Downloads & Request Hardening (`src/services/apiClient.ts`):** Added `res.body.getReader()` streaming progress, `AbortSignal` cancellation, mutation deduplication, and response shape validation.
- **Android Deep Links (`omnidoc://`):** Added `appUrlOpen` routing across `nativeBridge.ts`, `AuthContext.tsx`, and `App.tsx`.
- **Favicon Asset:** Added `public/favicon.svg`.

### New & Upgraded Document Studios
- **Word Studio (`WordStudioScreen.tsx`), PowerPoint Studio (`SlidesStudioScreen.tsx`), Excel Sheets Studio (`SheetsStudioScreen.tsx`), PDF Studio (`PdfStudioScreen.tsx`), Conversion Studio (`ConversionStudioScreen.tsx`), Library Preview (`LibraryScreen.tsx`), and `ConfirmDialog.tsx`.**
