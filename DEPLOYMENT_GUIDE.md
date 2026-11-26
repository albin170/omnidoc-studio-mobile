# OmniDoc Studio Mobile — Deployment, Signing & Release Guide

> **Distribution Policy:** Release builds are generated locally for QA verification and signed distribution preparation. Do **not** publish to Google Play Store without explicit authorization. Never commit `.env`, `android/keystore.properties`, `*.jks`, or `*.keystore` files.

---

## 1. Verified Release Artifacts

Generated with Vite `6.4.6`, Capacitor `7.4.4`, Gradle `9.7.1`, AGP `8.7.2`, and Eclipse Temurin JDK `21.0.13+9`:

| Artifact | Output Path | Verified Size |
| :--- | :--- | :--- |
| Debug APK | `android/app/build/outputs/apk/debug/app-debug.apk` | `8,328,910` bytes (`7.94 MB`) |
| Release APK (unsigned) | `android/app/build/outputs/apk/release/app-release-unsigned.apk` | `6,508,722` bytes (`6.21 MB`) |
| Release App Bundle (AAB) | `android/app/build/outputs/bundle/release/app-release.aab` | `5,882,244` bytes (`5.61 MB`) |

---

## 2. Environment Configuration

Copy `.env.example` (or `.env.production.example` / `.env.staging.example`) to `.env.local` (git-ignored) as needed:

- `VITE_APP_ENV=production`
- `VITE_API_PROD_URL=https://omnidoc-studio-jet.vercel.app/api/v1`
- `VITE_API_STAGING_URL=https://omnidoc-studio-jet.vercel.app/api/v1`
- `VITE_API_TIMEOUT_MS=30000`

All production and staging URLs enforce HTTPS via both `validateApiUrl()` (`src/config/env.ts`) and Android `network_security_config.xml`.

---

## 3. Signing Configuration (Upload Keystore)

Generate an upload keystore outside git tracking:

```powershell
keytool -genkeypair -v `
  -keystore android\omnidoc-release.jks `
  -alias omnidoc-upload `
  -keyalg RSA -keysize 2048 -validity 10000
```

Option A — Local properties file (`android/keystore.properties`, git-ignored, copy from `android/keystore.properties.example`):

```properties
storeFile=omnidoc-release.jks
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=omnidoc-upload
keyPassword=YOUR_KEY_PASSWORD
```

Option B — CI/CD environment variables (consumed automatically by `android/app/build.gradle`):
- `OMNIDOC_KEYSTORE_FILE`
- `OMNIDOC_KEYSTORE_PASSWORD`
- `OMNIDOC_KEY_ALIAS`
- `OMNIDOC_KEY_PASSWORD`

Build signed release artifacts:

```bash
npm run cap:sync
npm run android:release
npm run android:bundle
```

Verify APK signature:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.1.0\apksigner.bat" verify --verbose android\app\build\outputs\apk\release\app-release.apk
```

---

## 4. Device / Emulator Installation & Verification

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r android\app\build\outputs\apk\debug\app-debug.apk
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell am start -n studio.omnidoc.mobile/.MainActivity
```

---

## 5. Pre-Release Checklist

1. Confirm `git -C c:\Users\Dell\Documents\omnidoc-studio status --porcelain` is empty (shared web/backend untouched).
2. Confirm zero secrets (`.env`, `keystore.properties`, `*.jks`) are staged in `omnidoc-studio-mobile`.
3. Increment `versionCode` and `versionName` in `android/app/build.gradle` for store tracks.
4. Run full verification: `npm run typecheck && npm run build && npm test && npm run e2e:backend && npx cap sync android` and Gradle `testDebugUnitTest assembleDebug assembleRelease bundleRelease`.
5. Confirm `android:allowBackup="false"`, `android:usesCleartextTraffic="false"`, and `2026.1` consent versions remain active.
