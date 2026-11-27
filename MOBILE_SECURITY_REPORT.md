# OmniDoc Studio Mobile — Security Audit & Hardening Report

**Target Repository:** `c:\Users\Dell\Documents\omnidoc-studio-mobile` (`v2.1.0`, `versionCode: 2`)  
**Shared Backend Reference:** `c:\Users\Dell\Documents\omnidoc-studio`

---

## 1. Dependency Vulnerability Audit (`npm audit`)

| Advisory / Package | Severity | Previous State | Remediated State (`v2.1.0`) | Technical Fix & Controls |
| :--- | :--- | :--- | :--- | :--- |
| `xlsx` (`GHSA-4r6h-8v6p-xvw6` Prototype Pollution, `GHSA-5pgg-2g8v-p4x9` ReDoS) | High | Vulnerable (`xlsx@0.18.5`) | **RESOLVED** (`@datalens-tech/xlsx@^0.20.3`) | Replaced `xlsx@0.18.5` completely; retained `sanitizeWorkbookData()`, `25 MB` file cap, `5,000` row cap, `200` col cap, `cellHTML: false`. |
| `image-size` (`GHSA-5p2g-fcmc-qvqq`, `GHSA-w3rx-r6r6-pgpr` via `pptxgenjs`) | High | Present (`pptxgenjs@4.0.1`) | **RESOLVED** (`"overrides": { "image-size": "^2.2.0" }`) | Resolved transitive `image-size` to `>=2.2.0` while preserving `pptxgenjs` image embedding and strict `PNG`/`JPEG`/`WebP` validation. |
| `pdfjs-dist` (`GHSA-hq66-cqwq-w95j`) | High | Upgraded in `2.0.0` | **RESOLVED** (`^6.5.438`) | Legacy bundle + offline Vite-bundled worker (`pdf.worker.min.mjs`). |

**Audit Outcome:** Both `npm audit --omit=dev` and `npm audit` report **0 vulnerabilities** (`0 low, 0 moderate, 0 high, 0 critical`).

---

## 2. Authentication, Consent & Deep-Link Hardening

1. **Optional AI Consent Integrity (`omnidoc-studio/backend/app/api/v1/auth.py`, `src/screens/AuthScreen.tsx`):**
   - Registration differentiates mandatory agreements (`terms_accepted`, `privacy_accepted` -> HTTP `422` if `false`) from optional `ai_consent` and `marketing_consent` (`default=false`).
   - Backend records `granted=bool(data.ai_consent)` accurately in `ConsentRecord` with policy version (`"2026.1"`) and timestamp, verified against `/auth/consent/history`.
2. **One-Time Mobile Authorization Code Exchange (`AndroidManifest.xml`, `nativeBridge.ts`, `AuthContext.tsx`, `apiClient.ts`):**
   - Reusable JWTs in custom `omnidoc://` or HTTPS URLs are **rejected**.
   - Incoming App Links (`https://omnidoc-studio-jet.vercel.app/mobile/*`, `android:autoVerify="true"`) and allowlisted `omnidoc://` routes are parsed by `parseDeepLinkUrl()`. Auth callbacks accept only opaque `code` parameters exchanged once via `POST /api/v1/auth/mobile-code/exchange` (60s TTL, single-use hash, redirect URI allowlist).
3. **Strict JWT Validation (`src/services/secureStorage.ts`):**
   - `validateJwtStructure()` and `parseJwtPayload()` reject non-3-part or malformed Base64URL/JSON tokens.
   - `isJwtExpired()` fails closed when `exp` is missing, non-numeric, or expired (within clock skew window).

---

## 3. Native Android Keystore & Encrypted Offline Vault

### 3.1 Android Keystore Vault (`SecureVaultCrypto.java` & `SecureVaultPlugin.java`)
- **Algorithm:** `AES/GCM/NoPadding` with **256-bit** key (`omnidoc_mobile_vault_key_v1`) generated in `AndroidKeyStore`, fresh 12-byte GCM IV per write, and 128-bit authentication tag.
- **Key Lifecycle & Hardware Inspection:** Handles `KeyPermanentlyInvalidatedException` / `UnrecoverableKeyException` by resetting invalidated keys cleanly and returning `null` so corrupted entries never cause crashes or silent auth bypass. `getSecurityInfo()` inspects `KeyInfo` to report whether the key is backed by TEE/StrongBox.
- **Auxiliary Key Support:** `secureStorage.ts` provides hardware/session-protected key storage for WebCrypto offline AES-GCM encryption keys.

### 3.2 Encrypted User-Scoped Offline Cache (`src/services/offlineStore.ts`)
- `setActiveUser(userId)` binds the store to a SHA-256 hashed namespace.
- Sensitive cached artifacts (documents, jobs, usage, entitlements, local history) are **encrypted with WebCrypto AES-GCM 256-bit** before persistence and expire automatically after TTL (`24h` metadata / `7d` history).
- Tampered ciphertexts fail closed and purge the affected entry rather than throwing or returning stale data from another account.

### 3.3 Manifest & Release Signing Controls
- `android:allowBackup="false"`, `android:usesCleartextTraffic="false"` (loopback debug exception only in `network_security_config.xml`), minimal permissions (`INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA`).
- Signed release APK (`app-release.apk`) verified with `apksigner` (`v1 + v2` schemes, RSA-2048 cert SHA-256 `fb82c807d4b6fd61a2ff0ac981324e15bfb5a328ad54cd594d019cd588ad4f48`); upload keystore kept strictly outside Git (`~/.omnidoc-signing/omnidoc-release.jks`).

---

## 4. Genuine PDF Content Redaction (`src/engines/pdfRedactionService.ts`)

- **Real Content-Stream Scrubbing:** Uses `pako` to decompress `/FlateDecode` page content streams and `/Form` XObjects, strips matching literal strings `(text)`, escaped octal/char sequences, hex strings `<...>`, and segmented `[(t) -20 (ext)] TJ` kerning arrays, removes matching document metadata and annotations, re-compresses streams cleanly, and verifies output with both PDF.js extraction and raw Latin-1 stream inspection (`status: 'Verified' | 'Partial' | 'Failed'`).
- **Honest Non-Text Boundaries:** Detects unredacted embedded raster `/Image` XObjects, `/EmbeddedFiles`, and `/AcroForm` fields in the PDF and reports them explicitly in the UI rather than pretending visual black boxes erased pixels.

---

## 5. Server-Verified RBAC & Tenant Isolation

- **Admin Guard (`AdminScreen.tsx`):** Always verifies authorization live against `GET /api/v1/admin/me` on mount; even if client UI role state is tampered locally, HTTP `403` blocks rendering immediately.
- **Workspaces & Multi-Tenant Storage:** All `/workspaces/*` endpoints require matching `org_id` + workspace role membership (`403` cross-org), verified in live E2E Check #15 and `test_postgres_and_storage_integration.py`.
