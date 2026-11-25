# Security Architecture — OmniDoc Studio Mobile

## 1. Native Credential & Token Storage (`SecureVault`)

- **Android Implementation**: [SecureVaultPlugin.java](../android/app/src/main/java/studio/omnidoc/mobile/SecureVaultPlugin.java)
- **Cipher**: `AES/GCM/NoPadding` with a **256-bit** key (`omnidoc_mobile_vault_key_v1`) generated and stored inside hardware-backed **AndroidKeyStore**.
- **IV & Integrity**: Every write generates a fresh 12-byte random initialization vector (`IV`) and 128-bit GCM authentication tag, stored in `MODE_PRIVATE` `SharedPreferences`.
- **Tamper Handling**: Decryption failures automatically purge the corrupted entry and force re-authentication.
- **Zero Plaintext Persistence on Native**: JWT access tokens are never written to `localStorage` on Android.

---

## 2. Transport Security & Network Hardening

- **Network Security Config**: [network_security_config.xml](../android/app/src/main/res/xml/network_security_config.xml)
  - `<base-config cleartextTrafficPermitted="false">` enforces TLS/HTTPS for all staging and production connections.
  - Cleartext HTTP is explicitly scoped **only** to `10.0.2.2`, `localhost`, and `127.0.0.1` for local emulator development.
- **Application Manifest Controls**: [AndroidManifest.xml](../android/app/src/main/AndroidManifest.xml)
  - `android:allowBackup="false"` prevents ADB backup or cloud auto-backup extraction of encrypted preferences or cached state.
  - `android:usesCleartextTraffic="false"` sets strict default transport policy.
  - Minimal permissions requested: `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA`.
- **Client URL Guard**: `validateApiUrl()` in `src/config/env.ts` blocks non-HTTPS custom URLs in `staging` and `production`.

---

## 3. Session Lifecycle & Expiration

1. **Startup**: `AuthContext` retrieves the JWT from `SecureVault`, verifies `exp` locally (`isJwtExpired()`), and immediately re-validates via `GET /api/v1/auth/me`.
2. **Background / Foreground Resume**: `registerAppLifecycle` re-checks JWT expiry and server validity whenever the app returns to the foreground.
3. **Password Change Rotation**: `POST /api/v1/users/me/change-password` returns a fresh JWT bound to the incremented server `token_version`, which `apiClient` immediately rotates in `SecureVault`.
4. **401 Global Interception**: Any `401 Unauthorized` response immediately wipes `SecureVault`, clears `offlineStore`, and redirects to the login screen.
5. **Logout**: Calls `POST /api/v1/auth/logout` (blacklisting the token `jti` on the backend) and purges both `SecureVault` and `offlineStore`.

---

## 4. File Upload & Document Protection

- **Pre-Upload Validation**: `validateUploadFile()` inspects extension, size against plan `max_file_size_bytes`, magic-byte signatures (`%PDF-`, `PK\x03\x04`, PNG, JPEG, WebP), OLE2 legacy rejection, encrypted PDF/Office rejection, and XML/ZIP structure before sending bytes over the network.
- **Server Enforcement**: All tenant isolation (PostgreSQL RLS), quota locks (`SELECT ... FOR UPDATE`), and object storage path prefixing (`{org_id}/{doc_id}/{filename}`) remain enforced by the shared FastAPI backend.

---

## 5. Role-Based Access Control (RBAC)

- Admin capabilities require both:
  1. Server-verified `role` (`admin` or `superadmin`) obtained via `POST /api/v1/admin/auth/login` or `GET /api/v1/auth/me`.
  2. Server-side `require_admin` / `require_superadmin` enforcement on every `/api/v1/admin/*` endpoint.
- Non-admin users attempting to render `AdminScreen` receive an explicit `403 Forbidden` screen and cannot call admin APIs.
