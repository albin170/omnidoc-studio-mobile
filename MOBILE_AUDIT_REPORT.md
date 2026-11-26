# OmniDoc Studio Mobile — Phase 1 Technical & Parity Audit Report

**Target Repository:** `c:\Users\Dell\Documents\omnidoc-studio-mobile`  
**Read-Only Reference Repository:** `c:\Users\Dell\Documents\omnidoc-studio`  
**Audit Scope:** Client architecture, Capacitor native/Android configuration, security posture, dependency advisories, shared FastAPI backend integration, and feature parity against the OmniDoc Studio web platform.

---

## 1. Executive Summary

The baseline `omnidoc-studio-mobile` application establishes a solid Capacitor 7 + React 19 + TypeScript + Tailwind CSS v4 foundation backed by native `SecureVaultPlugin.java` (AndroidKeyStore AES-256-GCM), `CapacitorHttp` native networking, offline metadata caching, and local PDF/Sheets/Conversion engines.

However, a deep inspection against `omnidoc-studio` reveals **critical security/dependency gaps, missing office studios, incomplete PDF/conversion workflows, missing UX affordances (inline preview, streaming download progress, confirmation dialogs, deep links), and a static favicon 404**.

---

## 2. Severity Classification Key

- **P0 (Critical / Security & Blocker):** Exploitable dependency vulnerabilities, broken runtime guarantees, or critical safety regressions.
- **P1 (High / Core Functional Parity & UX Gaps):** Missing primary document studios, broken/missing user workflows, or missing destructive-action safeguards.
- **P2 (Medium / Operational Polish & Mobile Ergonomics):** Missing productivity enhancements, navigation alignment, or native integration polish.
- **P3 (Low / Minor Asset & Hygiene Issues):** Non-fatal console 404s, minor documentation or asset gaps.

---

## 3. Detailed Audit Findings (Baseline State)

### P0 — Critical Findings

1. **P0-1: Vulnerable `pdfjs-dist` (`^5.3.31`) — GHSA-hq66-cqwq-w95j (Arbitrary JavaScript Execution)**
   - **Location:** `package.json` (`"pdfjs-dist": "^5.3.31"`), verified via `npm audit --omit=dev`.
   - **Details:** `pdfjs-dist >=5.6.83 <6.2.108` (and earlier `5.x` lines flagged by advisory `1138116`, CWE-79) permits arbitrary JavaScript execution when opening a malicious PDF. The web repo (`omnidoc-studio/package.json`) already runs `pdfjs-dist ^6.4.299`.
   - **Remediation:** Upgrade `pdfjs-dist` to `>=6.2.108` (e.g., `^6.4.299` matching web) while verifying Vite's local worker resolution (`new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`).
   - **Note on Remaining Transitive/Legacy Advisories:** `npm audit --omit=dev` also reports `xlsx` (`<0.20.2`, `GHSA-4r6h-8v6p-xvw6` Prototype Pollution, `GHSA-5pgg-2g8v-p4x9` ReDoS — mitigated in `src/engines/sheetService.ts` via `sanitizeWorkbookData()` and row/col/size bounds, with `fixAvailable: false` on the npm registry) and `pptxgenjs` -> `image-size` (`GHSA-5p2g-fcmc-qvqq`, `GHSA-w3rx-r6r6-pgpr` — `fixAvailable` downgrades `pptxgenjs` to `4.0.0`, which breaks `4.0.1`). These must be documented and mitigated cleanly without breaking `pptxgenjs`.

2. **P0-2: Unverified Request Cancellation & Non-Streaming Document Downloads**
   - **Location:** `src/services/apiClient.ts` (`downloadDocument`, `uploadDocument`, `requestJson`).
   - **Details:** Baseline `downloadDocument(documentId)` calls `res.blob()` without streaming progress (`res.body.getReader()` + `Content-Length`) or `AbortSignal` cancellation, and `uploadDocument` / `getHealth` / `exportMyData` lack `AbortSignal` wiring and duplicate-submission protection. On large PDFs over mobile networks, users see no download progress and cannot cancel in-flight transfers.

---

### P1 — High-Severity Parity & Functional Findings

3. **P1-1: Missing Word Document Studio (`WordStudioScreen`)**
   - **Location:** `src/engines/docxService.ts` exists, but no `src/screens/WordStudioScreen.tsx` is wired into `App.tsx` or `StudiosHubScreen.tsx`.
   - **Web Reference:** `omnidoc-studio/src/components/docx/DocxStudio.tsx` provides rich editing, headings (H1–H3), bold/italic/underline, bullet lists, tables, find & replace, live word/character/reading-time counters, HTML sanitization (`sanitizeHtml` / `sanitizeImportedHtml`), DOCX/PDF/HTML/TXT export, and Cloud Project sync.
   - **Impact:** Mobile users cannot create, edit, or open `.docx` files from the Library or Cloud Projects.

4. **P1-2: Missing PowerPoint Presentation Studio (`SlidesStudioScreen`)**
   - **Location:** `src/engines/pptxService.ts` exists, but no `src/screens/SlidesStudioScreen.tsx` is implemented.
   - **Web Reference:** `omnidoc-studio/src/components/slides/SlideStudio.tsx` provides 16:9 slide editing, slide strip, add/duplicate/delete/reorder slides, visual themes, fullscreen presenter mode, and PPTX/PDF export + Cloud Project sync.
   - **Impact:** Mobile users cannot author, edit, present, or open `.pptx` files or `slides` Cloud Projects.

5. **P1-3: Missing Batch Conversion & ZIP Archive Export in `ConversionStudioScreen`**
   - **Location:** `src/screens/ConversionStudioScreen.tsx` and `src/engines/converter.ts`.
   - **Web Reference:** `omnidoc-studio/src/services/batchService.ts` (`runBatchConversion`) and `ConversionHub.tsx` support multi-file queues, upfront compatibility/fidelity checks (`getConversionCompatibilityReport`), and ZIP archive packaging (`createBatchZipArchive`).
   - **Impact:** Mobile users can only convert one file at a time with no upfront compatibility score or batch ZIP export.

6. **P1-4: Incomplete PDF Studio Capabilities (`PdfStudioScreen` & `pdfService.ts`)**
   - **Location:** `src/screens/PdfStudioScreen.tsx` & `src/engines/pdfService.ts`.
   - **Missing vs Web (`PdfStudio.tsx`):**
     - Interactive zoom controls (e.g., 50%–200% / fit width).
     - Text search & occurrence counting (`countTextOccurrencesInPdf` / `searchTextInPdf`).
     - Page reorder (move page up/down), duplicate page, insert blank page, and client-side compress/optimize.
     - Verified stream redaction / annotation overlays (highlight, text box, watermark) and Cloud Project save/sync.

7. **P1-5: Missing Inline Document Preview & Cloud Project Rename / Studio Opening in `LibraryScreen`**
   - **Location:** `src/screens/LibraryScreen.tsx`.
   - **Details:** Tapping a document only opens an action sheet; there is no inline preview modal (images via object URL with proper revocation, text/CSV/MD/HTML preview, PDF metadata + Digital Twin summary). Cloud Projects (`projects` section) cannot be renamed (`PATCH /projects/{id}/rename` missing in `apiClient.ts`) or loaded directly into Word/Slides/Sheets studios.

8. **P1-6: Missing Accessible Confirmation Dialog (`ConfirmDialog`) for Destructive Actions**
   - **Location:** `src/screens/LibraryScreen.tsx`, `SettingsScreen.tsx`, `AdminScreen.tsx`, `HistoryScreen.tsx`.
   - **Details:** Destructive actions (deleting documents/projects, suspending users, clearing offline cache, cancelling jobs, deleting account) lack a unified touch-friendly accessible `ConfirmDialog` component (`role="dialog"`, `aria-modal="true"`).

---

### P2 — Medium-Severity Architecture, Navigation & Native Integration Findings

9. **P2-1: Primary Navigation Structure Alignment**
   - **Location:** `src/types/index.ts`, `src/components/MobileLayout.tsx`, `src/App.tsx`.
   - **Details:** Baseline uses `home | library | studios | activity | more`. Aligning primary tabs to `home | convert | pdf | docs | profile` surfaces Conversion Studio, PDF Studio, and Documents as 1-tap primary tabs while routing Studios Hub, Word/Slides/Sheets Studios, History, Notifications, Settings, AI Assistant, and Admin Console cleanly via `MobileSubView`.

10. **P2-2: Missing Android Deep Links (`omnidoc://`) & `appUrlOpen` Listener**
    - **Location:** `android/app/src/main/AndroidManifest.xml`, `src/services/nativeBridge.ts`, `src/context/AuthContext.tsx`.
    - **Details:** `MainActivity` has only `MAIN`/`LAUNCHER` intent filter; no `<intent-filter>` for `omnidoc://` custom scheme exists, and `App.addListener('appUrlOpen', ...)` is not wired to route deep links safely.

11. **P2-3: Visual Polish & UI Surface Refinement**
    - **Location:** `src/components/MobileLayout.tsx`, `src/screens/*`.
    - **Details:** Baseline layout relies on generic gradient headers and ungrouped "More" actions; `ProfileScreen` should serve as a structured Account/Profile hub (Settings, Notifications, History, Developer API Keys, Admin Console gated by `isAdmin`).

12. **P2-4: Missing React Component UI Tests & Cross-User E2E Verification**
    - **Location:** `src/tests/*`, `scripts/run-backend-e2e.mjs`.
    - **Details:** Baseline Vitest suite (13 tests) covers services/engines only with zero `@testing-library/react` component tests (`AuthScreen`, `ConfirmDialog`, `MobileLayout`, `AdminScreen` 403 guard). `run-backend-e2e.mjs` does not test cross-user tenant isolation (User B attempting to read/download/delete User A's document) or `PATCH /projects/{id}/rename` + version history.

---

### P3 — Low-Severity Hygiene & Static Asset Findings

13. **P3-1: Missing `public/favicon.svg` Causing `/favicon.ico` 404**
    - **Location:** `index.html` & `public/`.
    - **Details:** `omnidoc-studio/public/favicon.svg` exists in the web repo, whereas `omnidoc-studio-mobile` has no `public/favicon.svg` and no `<link rel="icon">` in `index.html`, causing browser/WebView 404 requests for `/favicon.ico`.

---

## 4. Security Architecture Baseline Verification

The following security controls are **already present** in the baseline and must be preserved across all upgrades:
- `android:allowBackup="false"` and `android:usesCleartextTraffic="false"` in `AndroidManifest.xml`.
- `network_security_config.xml` permitting cleartext HTTP **only** for `10.0.2.2`, `localhost`, `127.0.0.1`.
- `SecureVaultPlugin.java` encrypting JWTs and session metadata using `AES/GCM/NoPadding` (256-bit) backed by `AndroidKeyStore`.
- `validateApiUrl()` enforcing `https://` for `staging` and `production`.
- `validateUploadFile()` checking magic bytes, OpenXML structure, encrypted PDF/Office rejection, and plan size limits.
- `offlineStore.clearUserCaches()` invoked on logout and HTTP `401` interception.
