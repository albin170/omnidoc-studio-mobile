# OmniDoc Studio Mobile — Architecture Guide

**Repository:** `c:\Users\Dell\Documents\omnidoc-studio-mobile`  
**App ID:** `studio.omnidoc.mobile`  
**Version:** `2.0.0` (`versionCode: 1`)  
**Platform Stack:** Capacitor 7 (`@capacitor/android ^7.4.4`) · React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS v4  
**Shared Backend Reference:** `c:\Users\Dell\Documents\omnidoc-studio` (read-only shared FastAPI + PostgreSQL/Supabase backend)

---

## 1. System Topology

```
+-------------------------------------------------------------------------+
|                     Android Shell (Capacitor 7)                         |
|  appId: studio.omnidoc.mobile  |  androidScheme: https  |  minSdk: 23   |
|  targetSdk: 35  |  compileSdk: 35  |  AGP 8.7.2  |  Gradle 9.7.1        |
+-------------------------------------------------------------------------+
|  React 19 + TypeScript Mobile UI (src/App.tsx, src/components/*)        |
|  Primary Bottom Navigation (5 Tabs):                                    |
|    Home | Convert | PDF | Docs | Profile                                |
|  Sub-Views (MobileSubView):                                             |
|    word_studio | slides_studio | sheets_studio | studios_hub | history  |
|    notifications | settings | admin | ai_assistant                      |
+------------------------------------+------------------------------------+
|  On-Device Document Engines        |  Core Services & Native Bridge     |
|  - pdfService.ts (pdf-lib +        |  - apiClient.ts (streaming DL,     |
|    pdfjs-dist legacy worker)       |    XHR upload progress, dedupe)    |
|  - docxService.ts (docx + jszip +  |  - secureStorage.ts -> SecureVault |
|    DOMParser XSS sanitizer)        |  - offlineStore.ts (Preferences)   |
|  - pptxService.ts (pptxgenjs +     |  - nativeBridge.ts (Camera, FS,    |
|    pdf-lib 16:9 slide PDF)         |    Share, App lifecycle, omnidoc://|
|  - sheetService.ts (xlsx + sandbox |    deep links, Network status)     |
|    formula parser + sanitizer)     |  - env.ts (HTTPS URL enforcement)  |
|  - converter.ts (11-format matrix, |                                    |
|    batch ZIP, compatibility report)|                                    |
|  - fileValidator.ts / formatDetector                                    |
+------------------------------------+------------------------------------+
|  Native Android Layer (android/app/src/main/)                           |
|  - MainActivity.java (registers SecureVaultPlugin)                      |
|  - SecureVaultPlugin.java (AndroidKeyStore AES-256-GCM)                 |
|  - AndroidManifest.xml (allowBackup=false, usesCleartextTraffic=false,  |
|    omnidoc:// intent-filter)                                            |
|  - xml/network_security_config.xml (HTTPS default; dev loopback only)   |
|  - xml/file_paths.xml (FileProvider for native sharing)                 |
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

## 2. Why `omnidoc-studio-mobile` Is Isolated From `omnidoc-studio`

1. **Zero Risk to Production Web & Backend:** The web app and FastAPI backend in `omnidoc-studio` remain completely unmodified (`git status` clean).
2. **Native Security & Storage:** Web `localStorage` is replaced by `SecureVaultPlugin.java` (`AndroidKeyStore` hardware-backed AES-256-GCM) on Android and `memoryFallback` + `sessionStorage` on web/test environments.
3. **Offline-First Document Engines:** `pdfService.ts` uses `pdfjs-dist/legacy/build/pdf.mjs` with a local Vite-bundled worker (`pdfjs-dist/legacy/build/pdf.worker.min.mjs` resolved via `import.meta.url`) instead of an external CDN URL, guaranteeing PDF rendering, search, manipulation, and camera scan-to-PDF work offline inside Android WebView (including WebViews older than Chromium 140).
4. **Native HTTP Without Backend CORS Edits:** `capacitor.config.ts` enables `CapacitorHttp: { enabled: true }`, routing requests through Android's native HTTP stack so the untouched backend's web-only `CORS_ORIGINS` list does not block mobile traffic.

---

## 3. Navigation & State Architecture

### 3.1 Primary Tabs (`MobileTab`) & Sub-Views (`MobileSubView`)
Defined in `src/types/index.ts` and rendered by `MobileLayout.tsx` + `src/App.tsx`:
- **5 Primary Tabs:**
  - `home` -> `DashboardScreen` (quota gauge, recent docs & jobs, quick launchers, announcements)
  - `convert` -> `ConversionStudioScreen` (single & multi-file batch queue, compatibility report, ZIP archive export, on-device & cloud conversion)
  - `pdf` -> `PdfStudioScreen` (zoom, search, reorder, duplicate, blank page, rotate, delete, split, merge, compress, annotations/signature/watermark, camera scan)
  - `docs` -> `LibraryScreen` (vault documents, inline preview modal, streaming download with progress/abort, Cloud Projects rename & studio launch)
  - `profile` -> `ProfileScreen` (user profile, password rotation, GDPR export, hub links to Studios Hub, Word/Slides/Sheets Studios, History, Notifications, Settings, AI Assistant, and `isAdmin`-gated Admin Console)

### 3.2 Hardware Back Button & `omnidoc://` Deep Links
- `nativeBridge.ts` (`registerAppLifecycle`) subscribes to Capacitor `App.addListener('backButton', ...)`, `appStateChange`, and `appUrlOpen`.
- **Back Navigation:** Pressing hardware back exits any active `MobileSubView` back to `'none'`, then navigates non-`home` tabs back to `'home'`.
- **Deep Links:** `AndroidManifest.xml` registers `<intent-filter android:autoVerify="false">` for `<data android:scheme="omnidoc" />`. Incoming URLs (e.g., `omnidoc://pdf`, `omnidoc://convert`, `omnidoc://docs`, `omnidoc://project?id=...`, `omnidoc://auth/logout`) are parsed in `nativeBridge.ts`, handled by `AuthContext.tsx`, and routed inside `App.tsx` once authenticated.

---

## 4. Build Chunking & Asset Bundling (`vite.config.ts`)

Vite splits production bundles into deterministic chunks:
- `vendor-pdf` (`pdf-lib`, `pdfjs-dist`) + standalone bundled worker `dist/assets/pdf.worker.min-*.mjs`
- `vendor-office` (`docx`, `pptxgenjs`, `xlsx`, `jszip`)
- `vendor-react` (`react`, `react-dom`)
- `vendor-utils` (Capacitor plugins, `lucide-react`)
- Static `public/favicon.svg` referenced in `index.html` (`<link rel="icon" type="image/svg+xml" href="./favicon.svg" />`).
