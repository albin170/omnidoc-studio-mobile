# Testing & Verification Report

## 1. Automated Verification Summary

| Suite | Command | Scope | Result |
| :--- | :--- | :--- | :--- |
| TypeScript Check | `npm run typecheck` (`tsc --noEmit`) | Strict type checking across `src/` | **PASS** (0 errors) |
| Production Web Bundle | `npm run build` (`vite build`) | Bundles React app + local `pdf.worker.min-*.mjs` into `dist/` | **PASS** |
| Vitest Unit & Engine Suite | `npm test` (`vitest run`) | 3 test files, 13 tests (Auth, Security, Validation, Network Retries, Offline Cache, PDF, Converter, Sheets) | **PASS (13/13)** |
| Live FastAPI Backend E2E | `node scripts/run-backend-e2e.mjs` | Unmodified `omnidoc-studio` FastAPI backend launched in isolated temp DB & vault | **PASS (11/11)** |
| Android Native JUnit | `.\gradlew.bat testDebugUnitTest` | `ExampleUnitTest` + `SecureVaultLogicTest` | **PASS (2/2)** |
| Android Debug APK | `.\gradlew.bat assembleDebug` | Full Android compilation & packaging | **PASS** (`7.58 MB`) |
| Android Release APK | `.\gradlew.bat assembleRelease` | Release APK packaging | **PASS** (`6.11 MB`) |
| Android App Bundle (AAB) | `.\gradlew.bat bundleRelease` | Play Store bundle packaging | **PASS** (`5.51 MB`) |

---

## 2. Live FastAPI Backend E2E Coverage (`scripts/run-backend-e2e.mjs`)

Executed against the unmodified `c:\Users\Dell\Documents\omnidoc-studio\backend` FastAPI app using an isolated temporary SQLite database and local vault directory:

1. `GET /health` liveness check.
2. `POST /api/v1/auth/register` with mandatory `2026.1` consent versions.
3. `POST /api/v1/auth/login` returning JWT (`access_token`, `user_id`, `org_id`, `role`, `plan_tier`).
4. `GET /api/v1/auth/me`, `/users/me/usage`, `/users/me/entitlements`.
5. `POST /api/v1/documents/upload`, `GET /api/v1/documents`, `GET /api/v1/documents/{id}/download` (byte-for-byte SHA match verified).
6. `POST /api/v1/jobs` & `GET /api/v1/jobs` processing history.
7. `POST /api/v1/projects` Cloud Project persistence (`sheets`).
8. `GET /api/v1/notifications` & `PUT /api/v1/notifications/preferences`.
9. Standard user calling `GET /api/v1/admin/telemetry` -> verified `403 Forbidden`.
10. `POST /api/v1/users/me/change-password` -> verified old JWT invalidated (`401`) and rotated JWT accepted (`200`).
11. `POST /api/v1/admin/auth/login` & `GET /api/v1/admin/telemetry` -> verified `200 OK` after admin role assignment, followed by `POST /api/v1/auth/logout` -> verified subsequent `/auth/me` returns `401 Unauthorized`.

---

## 3. Emulator / Device Verification Status

- `adb devices` and `emulator -list-avds` were inspected on this workstation: **no physical Android device or downloaded AVD system image is currently configured** (`system-images/` directory absent).
- Therefore, **live interactive UI execution on a booted Android Emulator or physical handset was not run automatically here**, and should be executed in Android Studio Device Manager following the checklist below.

### Manual Device / Emulator QA Checklist
- [ ] Cold launch splash screen (`#0B1120` + OmniDoc icon) and login screen render cleanly.
- [ ] Register & Sign In against live production (`https://omnidoc-studio-jet.vercel.app/api/v1`) and verify `SecureVault` persists across app kill/relaunch.
- [ ] Capture photo via Camera in PDF Studio -> convert to PDF -> upload to Vault with progress bar.
- [ ] Open Library offline (airplane mode) -> confirm cached documents & device processing history remain readable.
- [ ] App backgrounding -> return to foreground -> verify `onResume` re-validates session.
- [ ] Share exported `.pdf` / `.xlsx` via native Android share sheet (`FileProvider`).
- [ ] Verify non-admin login is blocked from Admin Console and Admin Portal login unlocks Telemetry & User controls.
