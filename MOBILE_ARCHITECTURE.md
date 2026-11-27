# OmniDoc Studio Mobile — Architecture Guide

**Repository:** `c:\Users\Dell\Documents\omnidoc-studio-mobile`  
**App ID:** `studio.omnidoc.mobile`  
**Version:** `2.1.0` (`versionCode: 2`)  
**Platform Stack:** Capacitor 7 (`@capacitor/android ^7.4.4`) · React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS v4 · ESLint 9 · Vitest 5  
**Shared Backend Reference:** `c:\Users\Dell\Documents\omnidoc-studio` (FastAPI + PostgreSQL/Supabase backend)

---

## 1. System Topology

```text
+-------------------------------------------------------------------------+
|                     Android Shell (Capacitor 7)                         |
|  appId: studio.omnidoc.mobile  |  androidScheme: https  |  minSdk: 23   |
|  targetSdk: 35  |  compileSdk: 35  |  AGP 8.7.2  |  Gradle 9.7.1        |
+-------------------------------------------------------------------------+
|  React 19 + TypeScript Mobile UI (src/App.tsx, src/components/*)        |
|  Primary Bottom Navigation (5 Tabs):                                    |
|    Home | Convert | PDF | Docs | Profile                                |
|  Sub-Views (MobileSubView — 11 routes):                                 |
|    word_studio | slides_studio | sheets_studio | ocr_studio |           |
|    workspaces | studios_hub | history | notifications | settings |      |
|    admin | ai_assistant                                                 |
+------------------------------------+------------------------------------+
|  On-Device Document & OCR Engines  |  Core Services & Native Bridge     |
|  - pdfService.ts (pdf-lib +        |  - apiClient.ts (streaming DL,     |
|    pdfjs-dist legacy + canvas wipe)|    finally-safe abort, sliced hash)|
|  - pdfRedactionService.ts (pako    |  - secureStorage.ts -> SecureVault |
|    FlateDecode/XObject/TJ scrub)   |    (strict JWT + aux AES key store)|
|  - docxService.ts (docx + jszip +  |  - offlineStore.ts (SHA-256 user   |
|    DOMParser XSS sanitizer)        |    scope + WebCrypto AES-GCM + TTL)|
|  - pptxService.ts (pptxgenjs +     |  - nativeBridge.ts (384KB chunked  |
|    image-size >= 2.2.0 override)   |    FS/Share, URI camera, App Links)|
|  - sheetService.ts (@datalens-tech |  - env.ts (HTTPS URL enforcement)  |
|    /xlsx@^0.20.3 + formula sandbox)|                                    |
|  - imageService.ts & ocrService.ts |                                    |
|  - converter.ts (output validation)|                                    |
+------------------------------------+------------------------------------+
|  Native Android Layer (android/app/src/main/)                           |
|  - MainActivity.java (registers SecureVaultPlugin)                      |
|  - SecureVaultPlugin.java & SecureVaultCrypto.java (AndroidKeyStore     |
|    AES-256-GCM, KeyInfo TEE/StrongBox inspection, key invalidation fix) |
|  - AndroidManifest.xml (allowBackup=false, usesCleartextTraffic=false,  |
|    verified HTTPS App Links + allowlisted omnidoc:// hosts)             |
|  - xml/network_security_config.xml (HTTPS default; dev loopback only)   |
|  - xml/file_paths.xml (FileProvider for 384KB-chunked native sharing)   |
+-------------------------------------------------------------------------+
                                    |
                                    | HTTPS + Bearer JWT (CapacitorHttp)
                                    v
+-------------------------------------------------------------------------+
|             Shared OmniDoc Studio FastAPI Backend (/api/v1)             |
|  Production: https://omnidoc-studio-jet.vercel.app/api/v1               |
|  PostgreSQL (Supabase + RLS)  |  Tenant-Isolated StorageVault           |
+-------------------------------------------------------------------------+
```

---

## 2. Navigation, Deep Links & Data Protection

### 2.1 Primary Tabs & Sub-Views (`src/types/index.ts`, `src/App.tsx`)
- **5 Primary Tabs:** `home` (`DashboardScreen`), `convert` (`ConversionStudioScreen`), `pdf` (`PdfStudioScreen`), `docs` (`LibraryScreen`), `profile` (`ProfileScreen`).
- **11 Sub-Views:** `word_studio`, `slides_studio`, `sheets_studio`, `ocr_studio` (`OcrImageStudioScreen`), `workspaces` (`WorkspacesScreen`), `studios_hub` (`StudiosHubScreen`), `history`, `notifications`, `settings`, `admin` (`AdminScreen`), `ai_assistant`.

### 2.2 App Links & Route Validation (`nativeBridge.ts`, `AuthContext.tsx`)
- `AndroidManifest.xml` registers both `<intent-filter android:autoVerify="true">` for `https://omnidoc-studio-jet.vercel.app/mobile` and scoped `omnidoc://` hosts.
- `parseDeepLinkUrl()` permits only allowlisted paths/hosts (`/pdf`, `/convert`, `/docs`, `/sheets`, `/ocr`, `/workspaces`, `/project`, `/auth/*`), strips/rejects any URL containing an embedded `token`/`access_token` query or fragment, and exchanges opaque single-use `code` parameters via `POST /api/v1/auth/mobile-code/exchange`.

### 2.3 Encrypted User-Scoped Offline Cache & Streaming I/O
- `offlineStore.ts` hashes `userId` via SHA-256 and encrypts cached user/tenant metadata (documents, jobs, usage, entitlements, history) using WebCrypto AES-GCM 256-bit keys stored in `secureStorage`, automatically expiring stale caches via TTL and failing closed on ciphertext corruption.
- `nativeBridge.ts` streams file saves & shares in **384 KB Base64 chunks** (`Filesystem.writeFile` + `Filesystem.appendFile`) with abort cleanup and `OmniDocShare` cache purging to prevent Android WebView bridge OOMs.

---

## 3. Build Chunking & Asset Bundling (`vite.config.ts`)
- `vendor-pdf` (`pdf-lib`, `pdfjs-dist`, `pako`) + bundled worker `dist/assets/pdf.worker.min-*.mjs`
- `vendor-office` (`docx`, `pptxgenjs`, `@datalens-tech/xlsx`, `jszip`)
- `vendor-react` (`react`, `react-dom`) & `vendor-utils` (Capacitor plugins, `lucide-react`)
