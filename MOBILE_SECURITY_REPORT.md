# OmniDoc Studio Mobile — Security Audit & Hardening Report

**Target Repository:** `c:\Users\Dell\Documents\omnidoc-studio-mobile`  
**Shared Backend Reference:** `c:\Users\Dell\Documents\omnidoc-studio` (unmodified)

---

## 1. Dependency Vulnerability Audit (`npm audit --omit=dev`)

| Advisory / Package | Severity | Baseline Status | Post-Remediation Status | Controls & Notes |
| :--- | :--- | :--- | :--- | :--- |
| `pdfjs-dist` (`GHSA-hq66-cqwq-w95j`, Arbitrary JS Execution, `<6.2.108`) | High | **Vulnerable** (`^5.3.31`) | **RESOLVED** (`^6.5.438`) | Upgraded to `pdfjs-dist@^6.5.438` using `pdfjs-dist/legacy/build/pdf.mjs` + local Vite-bundled `pdf.worker.min.mjs`. |
| `xlsx` (`GHSA-4r6h-8v6p-xvw6` Prototype Pollution, `GHSA-5pgg-2g8v-p4x9` ReDoS) | High | Present (`^0.18.5`, `fixAvailable: false`) | Present (`fixAvailable: false`) — **Mitigated in code** | `src/engines/sheetService.ts` applies `sanitizeWorkbookData()` (stripping `__proto__`, `constructor`, `prototype`), `25 MB` file cap, `5,000` row cap, `200` column cap, and `cellHTML: false`. |
| `image-size` (`GHSA-5p2g-fcmc-qvqq`, `GHSA-w3rx-r6r6-pgpr` via `pptxgenjs ^4.0.1`) | High | Present (`fixAvailable` forces breaking downgrade to `pptxgenjs@4.0.0`) | Preserved (`pptxgenjs ^4.0.1`) — **Mitigated** | Client does not parse untrusted JXL/HEIF/ICNS streams through `image-size`; `validateUploadFile` restricts accepted images to magic-byte-verified `PNG`, `JPEG`, and `WebP`. |

Total `npm audit --omit=dev` findings reduced from **4 high** (baseline) to **3 high** (upstream-only `xlsx` and `pptxgenjs -> image-size`, zero `pdfjs-dist` advisories).

---

## 2. Native Android Security Controls

### 2.1 Hardware-Backed Token Vault (`SecureVaultPlugin.java`)
- **Location:** `android/app/src/main/java/studio/omnidoc/mobile/SecureVaultPlugin.java`
- **Encryption:** `AES/GCM/NoPadding` with a **256-bit** key (`omnidoc_mobile_vault_key_v1`) stored in `AndroidKeyStore`.
- **Integrity:** Each `set()` generates a fresh 12-byte GCM IV and 128-bit authentication tag stored in `Context.MODE_PRIVATE` `SharedPreferences`. Decryption errors auto-purge the corrupted entry and return `null` so the user must re-authenticate.
- **Zero `localStorage` JWT Storage:** `src/services/secureStorage.ts` uses `SecureVault` on native Android and `memoryFallback` + `sessionStorage` in browser/test runtimes.

### 2.2 Manifest & Network Security (`AndroidManifest.xml` & `network_security_config.xml`)
- `android:allowBackup="false"` prevents ADB or cloud backup extraction of encrypted vault preferences or offline caches.
- `android:usesCleartextTraffic="false"` and `<base-config cleartextTrafficPermitted="false">` block unencrypted HTTP across staging and production.
- Cleartext HTTP is strictly restricted to `10.0.2.2`, `localhost`, and `127.0.0.1` for local emulator testing.
- Minimal permissions: `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA`.
- Deep-link `<intent-filter android:autoVerify="false">` scopes custom `omnidoc://` URIs cleanly; `AuthContext.tsx` validates any incoming token against `isJwtExpired()` and server `GET /auth/me` before trusting it.

---

## 3. Application & Client Engine Hardening

1. **HTTPS URL Enforcement (`src/config/env.ts`):** `validateApiUrl()` blocks non-HTTPS custom URLs in `staging` and `production` and rejects non-HTTP(S) schemes.
2. **Session Lifecycle & Token Rotation (`AuthContext.tsx`, `apiClient.ts`):**
   - Cold boot and foreground resume (`onResume`) check `isJwtExpired()` and validate against `GET /api/v1/auth/me`.
   - `changePassword()` immediately rotates the stored JWT in `SecureVault` when the backend increments `token_version`.
   - Any HTTP `401` globally clears `SecureVault`, purges `offlineStore`, and redirects to `AuthScreen`.
   - `logout()` calls `POST /api/v1/auth/logout` (revoking `jti` server-side) and wipes local vault and caches.
3. **Offline Cache Isolation (`src/services/offlineStore.ts`):**
   - `clearUserCaches()` deletes documents, jobs, usage metrics, entitlements, local processing history, and sync timestamps on logout or `401`, preventing cross-account data exposure on shared devices.
4. **File & Content Validation (`fileValidator.ts`, `formatDetector.ts`):**
   - Validates magic bytes (`%PDF-`, `PK\x03\x04`, `\x89PNG`, `\xFF\xD8\xFF`, `RIFF...WEBP`), rejects legacy OLE2 (`D0 CF 11 E0`) binaries, rejects encrypted PDFs (`/Encrypt`) and encrypted OpenXML (`EncryptedPackage` / `EncryptionInfo`), and enforces plan `max_file_size_bytes`.
5. **XSS & Injection Defenses (`docxService.ts`, `converter.ts`, `sheetService.ts`):**
   - `sanitizeHtml()` strips `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<applet>`, `<base>`, `<form>`, inline `on*` event handlers, and `javascript:` / `vbscript:` / `data:text/html` URLs + unsafe CSS `expression()`.
   - `escapeHtml()` escapes all interpolated text in HTML conversions.
   - `sanitizeWorkbookData()` blocks `__proto__`, `constructor`, and `prototype` keys.
6. **RBAC & Cross-Tenant Isolation:**
   - `AdminScreen.tsx` enforces a client-side `403 Forbidden` guard when `isAdmin` is false (never calling `/admin/*` APIs), backed by server-side `require_admin` / `require_superadmin` and PostgreSQL RLS tenant isolation verified in `scripts/run-backend-e2e.mjs`.
7. **Destructive Action Safeguards (`ConfirmDialog.tsx`):**
   - All destructive actions (document/project deletion, account deletion, API key revocation, user suspension, job cancellation, cache/history clearing, sign out) require explicit confirmation via an accessible `role="alertdialog"` modal.
