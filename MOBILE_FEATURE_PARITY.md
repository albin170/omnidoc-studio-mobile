# OmniDoc Studio Mobile — Web vs. Mobile Feature Parity Matrix

**Reference Web Repo:** `c:\Users\Dell\Documents\omnidoc-studio`  
**Mobile Repo:** `c:\Users\Dell\Documents\omnidoc-studio-mobile`

This matrix tracks feature parity across every module of OmniDoc Studio Web and OmniDoc Studio Mobile after Phase 2–4 implementation and verification.

---

## 1. Studio & Workspace Parity Matrix

| Module / Capability | Web Reference (`omnidoc-studio`) | Mobile Baseline | Mobile Current State | Notes / Mobile Adaptation |
|---|---|---|---|---|
| **Authentication & Consent** | Register (`2026.1` consents), Login, Admin Login, Forgot/Reset Password, JWT revocation | ✅ Implemented | ✅ Hardened + UI Tested | `SecureVault` (`AndroidKeyStore` AES-256-GCM) on Android; explicit `id`/`htmlFor`/`autoComplete` on `AuthScreen` |
| **Dashboard / Home** | Usage gauge, recent docs, quick actions, system announcements, maintenance banner | ✅ Implemented | ✅ Enhanced | Quota gauge, doc/job/role metrics, unread card, 6 studio launchers, AI card, pull-to-refresh |
| **Navigation Shell** | Desktop collapsible sidebar + command palette | 🟡 `home/library/studios/activity/more` | ✅ `home/convert/pdf/docs/profile` + 9 sub-views | 5-tab bottom bar + Android back button + `omnidoc://` deep links |
| **Document Library & Vault** | Upload, download, delete, digital twin inspection, search/filter | 🟡 No inline preview, no streaming download progress | ✅ Full preview modal + streaming progress + abort | Images (object URL with cleanup), text/CSV/MD/HTML preview, PDF/Office metadata + Digital Twin |
| **Cloud Projects** | Create, list, load, update (`PUT`), rename (`PATCH /rename`), version history, optimistic `409` lock | 🟡 List & Sheets save only | ✅ Rename + load into Word/Slides/Sheets + `409` conflict guard | Verified live against `/api/v1/projects` in `run-backend-e2e.mjs` |
| **PDF Studio** | Render, zoom, thumbnails, rotate, reorder, duplicate, insert blank, delete, split, merge, search, watermark, redaction, signatures, compress | 🟡 Basic operations only | ✅ Zoom (`0.75x–2.25x`), search, reorder, duplicate, blank page, compress, visual overlays/signature pad, camera scan | Local Vite-bundled `pdfjs-dist` legacy worker (`100%` offline); visual overlays explicitly labeled |
| **Word Document Studio** | `DocxStudio` (H1–H3, formatting, bullets, tables, find/replace, word count, DOCX/PDF/HTML/TXT export, HTML sanitization) | ❌ Missing | ✅ `WordStudioScreen` + sanitized `docxService.ts` | XSS-safe `sanitizeHtml`, touch toolbar, Find & Replace, Cloud Project sync |
| **PowerPoint Studio** | `SlideStudio` (16:9 editor, themes, add/dup/del/reorder slides, fullscreen presenter, PPTX/PDF export) | ❌ Missing | ✅ `SlidesStudioScreen` | Touch slide strip, 6 themes, fullscreen swipe presenter, PPTX/PDF export, Cloud Project sync |
| **Excel Sheets Studio** | `SheetStudio` (multi-sheet grid, formulas, sort, dedup, XLSX/CSV/PDF export) | ✅ Implemented | ✅ Enhanced + Cloud Project load/save | Added row/col/sheet editing, cell bold/align metadata, inline reset confirm |
| **Conversion Studio** | 11-format converter, compatibility report, multi-file batch queue, ZIP archive export | 🟡 Single-file only | ✅ Single + Batch queue + deduplicated ZIP + compatibility report | On-device engines + Cloud `convert_document` tool invoke with `AbortSignal` |
| **Image Studio** | Crop, resize, rotate, filters, layers, color-distance BG removal | 🟡 `imageService.ts` | 🟡 Scoped to Camera scan + Image↔PDF/PNG/JPG/WEBP conversion | Intentional mobile scope; desktop multi-layer canvas kept on web |
| **OCR Scanner** | `tesseract.js` multi-language OCR | 🟡 Server-side via Jobs / AI RAG | 🟡 Cloud/AI extraction + Camera Scan to PDF | Avoids bundling ~30 MB of Tesseract traineddata in mobile APK |
| **AI Assistant & RAG** | OmniCore agents + Local RAG index & query | ✅ Implemented | ✅ Preserved | Uses shared `/api/v1/local-ai/rag/*` and `/api/v1/agents/execute` |
| **Processing History & Jobs** | Autonomous DAG jobs + local conversion history | ✅ Implemented | ✅ Enhanced with `ConfirmDialog` | Cloud Jobs + Device History dual tabs |
| **Notifications & Support** | Notifications list, read/read-all, preferences, announcements, support messages | ✅ Implemented | ✅ Enhanced with `ConfirmDialog` | Live unread badge + category/status filtering |
| **Profile & Settings** | Profile edit, password rotation, GDPR export, account delete, API keys, consents, env switcher | 🟡 Split across 3 tabs | ✅ Consolidated Profile hub + `ConfirmDialog` | Settings, Notifications, History, Studios Hub, AI Assistant, API Keys, and `isAdmin`-gated Admin Console |
| **Admin Console** | Telemetry, user directory, suspend/reactivate, global UI banner/maintenance, audit logs | ✅ Implemented | ✅ Enhanced with `ConfirmDialog` | Client `403` guard + server `require_admin` enforcement |

---

## 2. Format Conversion Route Parity (11 Formats)

Both Web and Mobile `FORMAT_REGISTRY` support all 11 formats (`pdf`, `docx`, `pptx`, `xlsx`, `csv`, `png`, `jpg`, `webp`, `txt`, `html`, `md`):

| Source Format | Supported Target Formats (Mobile `FORMAT_REGISTRY`) | Verified Compatibility Classifications |
|---|---|---|
| `pdf` | `docx`, `txt`, `png`, `jpg`, `pptx`, `pdf` | `pdf -> pdf`: native (stream optimize); `png`/`jpg`: rasterized; `docx`/`txt`/`pptx`: extraction |
| `docx` | `pdf`, `txt`, `html` | Extraction (`docxService` + `jszip`) |
| `pptx` | `pdf`, `png`, `jpg`, `docx`, `txt` | `png`/`jpg`: rasterized; `pdf`/`docx`/`txt`: extraction (`pptxService` + `jszip`) |
| `xlsx` | `csv`, `pdf`, `html`, `txt` | `csv`/`html`: native tabular; `pdf`/`txt`: extraction (`sheetService`) |
| `csv` | `xlsx`, `pdf`, `txt`, `html` | `xlsx`/`html`: native tabular; `pdf`/`txt`: extraction |
| `png` | `pdf`, `jpg`, `webp` | Native raster (`imageService`) |
| `jpg` | `pdf`, `png`, `webp` | Native raster (`imageService`) |
| `webp` | `pdf`, `png`, `jpg` | Native raster (`imageService`) |
| `txt` | `pdf`, `docx`, `html` | Extraction / structured build |
| `html` | `pdf`, `docx`, `txt` | Extraction / structured build |
| `md` | `pdf`, `docx`, `html`, `txt` | Extraction / structured build |
