# OmniDoc Studio Mobile — Web vs. Mobile Feature Parity Matrix

**Reference Web Repo:** `c:\Users\Dell\Documents\omnidoc-studio`  
**Mobile Repo:** `c:\Users\Dell\Documents\omnidoc-studio-mobile` (`v2.1.0`)

This matrix documents verified feature parity between OmniDoc Studio Web and OmniDoc Studio Mobile after full security remediation, studio completion, and production release packaging.

---

## 1. Studio, Collaboration & Admin Parity Matrix

| Module / Capability | Web Reference (`omnidoc-studio`) | Mobile (`v2.1.0`) | Notes / Mobile Adaptation |
| :--- | :--- | :--- | :--- |
| **Authentication & Consent** | Register (`2026.1` consents), Login, Admin Login, Forgot/Reset Password, OAuth callbacks | ✅ Full Parity + Security Hardened | Respects optional `ai_consent` (`false` default), uses HTTPS App Links + one-time `/auth/mobile-code/exchange`, hardware-backed `SecureVault` (`AndroidKeyStore`), fail-closed JWT checks |
| **Dashboard / Home** | Quota gauge, recent docs, quick actions, announcements, maintenance banner | ✅ Full Parity | Live quota gauge, doc/job/role cards, unread pill, studio launchers (including OCR/Image & Workspaces), pull-to-refresh |
| **Navigation Shell** | Desktop collapsible sidebar + command palette | ✅ Native 5-Tab Shell + 11 Sub-Views | Bottom tabs (`Home`, `Convert`, `PDF`, `Docs`, `Profile`), hardware back handling, validated HTTPS & `omnidoc://` deep links |
| **Document Library & Vault** | Upload, download, delete, Digital Twin, search/filter | ✅ Full Parity + Encrypted Offline | Chunked native 384 KB streaming (`saveFileToDevice`/`shareDocumentFile`), abort cleanup, sliced 64 KB SHA-256 upload dedupe, AES-GCM encrypted `offlineStore` cache, Digital Twin `page_count` fix |
| **Cloud Projects** | Create, list, load, update (`PUT`), rename (`PATCH /rename`), versions, `409` lock | ✅ Full Parity | Payload-digest mutation keys prevent false dedupe; supports loading/saving across PDF, Word, Slides, and Sheets |
| **PDF Studio & Redaction** | Merge, split, rotate, reorder, duplicate, blank page, delete, zoom, search, annotations, compress, genuine content redaction | ✅ Full Parity | Offline Vite-bundled `pdfjs-dist` legacy worker; **genuine `pako`-based FlateDecode/XObject/TJ-array content redaction** (`pdfRedactionService.ts`) with PDF.js + Latin-1 binary verification & explicit non-text warnings |
| **Word Document Studio** | `DocxStudio` (H1–H3, formatting, find/replace, DOCX/PDF/HTML/TXT export) | ✅ Full Parity | `WordStudioScreen` + hardened `docxService.ts` (`sanitizeHtml` free of control-regex lint issues) |
| **PowerPoint Studio** | `SlideStudio` (16:9 editor, themes, slide ops, fullscreen presenter, PPTX/PDF export) | ✅ Full Parity | `SlidesStudioScreen` + `pptxService.ts` using patched `image-size >= 2.2.0` override |
| **Excel Sheets Studio** | `SheetStudio` (multi-sheet grid, formulas, sort, dedup, XLSX/CSV/PDF export) | ✅ Full Parity | Migrated to maintained **`@datalens-tech/xlsx@^0.20.3`**, keeping all formula/chart/sheet features and prototype-pollution/size protections |
| **Conversion Studio** | 11-format converter, compatibility report, batch queue, ZIP archive export | ✅ Full Parity | Upfront `device`/`cloud` fidelity badges, `validateConversionOutput` ZIP `PK\x03\x04` & magic-byte validation, deduplicated ZIP bundles |
| **OCR & Image Studio** | Client/Cloud OCR extraction, image compression/resizing, format conversion, PDF-to-PNG | ✅ Mobile Studio (`OcrImageStudioScreen`) | `ocrService.ts` (on-device PDF text stream + Cloud `/tools/invoke` `extract_fields` / Digital Twin fallback with clear offline indicator), multi-page camera scan queue, `.txt`/`.docx` export, `compressAndResizeImage`, PNG/JPG/WebP + PDF-to-PNG |
| **Team Workspaces** | Shared workspaces, invitations (send/accept/reject), shared documents, role management, team chat | ✅ Mobile Studio (`WorkspacesScreen`) | Full 15-endpoint `/workspaces/*` integration: pending invites inbox, workspace switcher, Shared Docs, Members & Invites, and Team Chat with unread badge |
| **AI Assistant & RAG** | OmniCore agents + Local RAG index & query | ✅ Full Parity | Respects AI consent, connects to `/api/v1/local-ai/rag/*` and `/api/v1/agents/*` |
| **Processing History & Notifications** | Cloud DAG jobs, local history, notifications, announcements, support inbox | ✅ Full Parity | Dual Cloud/Device history tabs, `ConfirmDialog` confirmations, real-time unread counts |
| **Profile & Account Settings** | Profile edit, password rotation, GDPR export, API keys, consents, env switcher | ✅ Full Parity | Consolidated Profile Hub linking all studios, workspaces, settings, consents, keys, and admin portal |
| **Admin Console** | Telemetry, users, suspend/reactivate, plan & entitlement overrides, UI banner, audit logs | ✅ Full Parity + Server Guard | Always verifies `GET /api/v1/admin/me` on mount (`403` block if unauthorized); adds org subscription plan selector & user entitlement override controls |
