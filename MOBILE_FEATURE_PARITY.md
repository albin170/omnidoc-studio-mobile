# OmniDoc Studio Mobile — Web vs. Mobile Feature Parity Matrix

**Reference Web Repo:** `c:\Users\Dell\Documents\omnidoc-studio`  
**Mobile Repo:** `c:\Users\Dell\Documents\omnidoc-studio-mobile`

This matrix tracks feature parity across every module of OmniDoc Studio Web and OmniDoc Studio Mobile (baseline state prior to Phase 2 upgrades vs. target/implemented mobile parity).

---

## 1. Studio & Workspace Parity Matrix

| Module / Capability | Web Reference (`omnidoc-studio`) | Mobile Baseline (Pre-Upgrade) | Mobile Target State | Notes / Mobile Adaptation |
|---|---|---|---|---|
| **Authentication & Consent** | Register (`2026.1` consents), Login, Admin Login, Forgot/Reset Password, JWT revocation | ✅ Implemented (`AuthScreen`, `AuthContext`) | ✅ Hardened + UI Tested | Uses native `SecureVault` (`AndroidKeyStore` AES-256-GCM) instead of `localStorage` |
| **Dashboard / Home** | Usage gauge, recent docs, quick actions, system announcements, maintenance banner | ✅ Implemented (`DashboardScreen`) | ✅ Enhanced | Quick links to all studios, camera scan-to-PDF, live storage quota |
| **Navigation Shell** | Desktop collapsible sidebar + command palette | 🟡 5 tabs (`home/library/studios/activity/more`) | ✅ 5 tabs (`home/convert/pdf/docs/profile`) + sub-views | Touch-first bottom nav + Android hardware back button + `omnidoc://` deep links |
| **Document Library & Vault** | Upload, download, delete, digital twin inspection, search/filter | 🟡 No inline preview, no streaming download progress | ✅ Full preview modal + streaming download progress + abort | Images (object URL), text/CSV/MD/HTML preview, PDF metadata + Digital Twin |
| **Cloud Projects** | Create, list, load, update (`PUT`), rename (`PATCH /rename`), version history, optimistic `409` lock | 🟡 List & save Sheets only; no rename or load into studios | ✅ Rename + load into Word/Slides/Sheets + version/conflict handling | Syncs directly with shared `/api/v1/projects` |
| **PDF Studio** | Render, zoom (50–250%), thumbnails, rotate, reorder, duplicate, insert blank, delete, split, merge, search, watermark, redaction, signatures, compress | 🟡 Render, rotate, delete, split, merge, watermark, text extract, camera scan | ✅ Zoom, text search, reorder, duplicate, insert blank, compress, redact/annotate, cloud save | Local Vite-bundled `pdfjs-dist` worker works 100% offline |
| **Word Document Studio** | `DocxStudio` (H1–H3, formatting, bullets, tables, find/replace, word count, DOCX/PDF/HTML/TXT export, HTML sanitization) | ❌ Missing screen (`docxService.ts` only) | ✅ `WordStudioScreen` + sanitized `docxService.ts` | Touch toolbar, XSS-safe `sanitizeHtml`, Cloud Project save/load |
| **PowerPoint Studio** | `SlideStudio` (16:9 editor, themes, add/dup/del/reorder slides, fullscreen presenter, PPTX/PDF export) | ❌ Missing screen (`pptxService.ts` only) | ✅ `SlidesStudioScreen` | Touch slide strip, theme presets, fullscreen slideshow, PPTX/PDF export |
| **Excel Sheets Studio** | `SheetStudio` (multi-sheet grid, 35+ formulas, sort, dedup, XLSX/CSV/PDF export) | ✅ Implemented (`SheetsStudioScreen`) | ✅ Enhanced + Cloud Project load/save | Sandboxed formula evaluator + prototype-pollution sanitization |
| **Conversion Studio** | 11-format converter, compatibility report, multi-file batch queue, ZIP archive export | 🟡 Single-file conversion only | ✅ Single + Batch queue + ZIP archive + compatibility report + cloud tool invoke | Runs on-device or via `POST /tools/invoke` (`convert_document`) |
| **Image Studio** | Crop, resize, rotate, filters, layers, color-distance BG removal | 🟡 `imageService.ts` used by converter; camera scan-to-PDF | 🟡 Mobile scope: Camera scan + Image↔PDF/PNG/JPG/WEBP conversion | Heavy desktop layer canvas intentionally scoped to conversion/scan on mobile |
| **OCR Scanner** | `tesseract.js` multi-language OCR | 🟡 Server-side via Jobs / AI RAG; no bundled `tesseract.js` (~30MB traineddata) | 🟡 Cloud/AI extraction + Camera Scan to PDF | Avoids bloating APK with multi-language WASM traineddata |
| **AI Assistant & RAG** | OmniCore agents + Local RAG index & query | ✅ Implemented (`AiAssistantScreen`) | ✅ Preserved | Respects `ai_consent` and online connectivity |
| **Processing History & Jobs** | Autonomous DAG jobs (create/approve/cancel) + local conversion history | ✅ Implemented (`HistoryScreen`) | ✅ Enhanced with `ConfirmDialog` | Dual tabs: Cloud Jobs & Device History |
| **Notifications & Support** | Notifications list, read/read-all, preferences, announcements, support messages | ✅ Implemented (`NotificationsScreen`) | ✅ Preserved | Unread badge synced to top app bar |
| **Profile & Settings** | Profile edit, password rotation, GDPR export, account delete, API keys, consents, env switcher | ✅ Split across `ProfileScreen`, `SettingsScreen`, `MoreScreen` | ✅ Consolidated Profile hub + `ConfirmDialog` | Clean Account/Profile hub with API keys, consents, GDPR export, env config |
| **Admin Console** | Telemetry, user directory, suspend/reactivate, global UI banner/maintenance, audit logs | ✅ Implemented (`AdminScreen` with 403 guard) | ✅ Enhanced with `ConfirmDialog` | Server-verified `admin`/`superadmin` RBAC |

---

## 2. Format Conversion Route Parity (11 Formats)

Both Web and Mobile `FORMAT_REGISTRY` support the exact same 11 formats (`pdf`, `docx`, `pptx`, `xlsx`, `csv`, `png`, `jpg`, `webp`, `txt`, `html`, `md`):

| Source Format | Supported Target Formats (Mobile `FORMAT_REGISTRY`) | Execution Mode |
|---|---|---|
| `pdf` | `docx`, `txt`, `png`, `jpg`, `pptx`, `pdf` | On-device (`pdfService` + `pdfjs-dist`) or Cloud |
| `docx` | `pdf`, `txt`, `html` | On-device (`docxService` + `jszip`) or Cloud |
| `pptx` | `pdf`, `png`, `jpg`, `docx`, `txt` | On-device (`pptxService` + `jszip`) or Cloud |
| `xlsx` | `csv`, `pdf`, `html`, `txt` | On-device (`sheetService` + `xlsx`) or Cloud |
| `csv` | `xlsx`, `pdf`, `txt`, `html` | On-device (`sheetService`) or Cloud |
| `png` | `pdf`, `jpg`, `webp` | On-device (`imageService`) or Cloud |
| `jpg` | `pdf`, `png`, `webp` | On-device (`imageService`) or Cloud |
| `webp` | `pdf`, `png`, `jpg` | On-device (`imageService`) or Cloud |
| `txt` | `pdf`, `docx`, `html` | On-device or Cloud |
| `html` | `pdf`, `docx`, `txt` | On-device or Cloud |
| `md` | `pdf`, `docx`, `html`, `txt` | On-device or Cloud |

*Status will be updated with exact post-upgrade verification metrics once all Phase 2–4 tasks and full test suites complete.*
