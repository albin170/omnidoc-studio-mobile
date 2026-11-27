# OmniDoc Studio Mobile — Deployment, Signing & CI/CD Guide

> **Security Policy:** Release artifacts are signed using an external PKCS12 upload keystore kept strictly outside Git (`%USERPROFILE%\.omnidoc-signing\omnidoc-release.jks`). Never commit `*.jks`, `*.keystore`, `android/keystore.properties`, or `.env*` secret files. Do **not** publish to Google Play Store without explicit release sign-off.

---

## 1. Verified Release Artifacts (`v2.2.0`, `versionCode: 3`)

| Artifact | Output Path | Exact Size | SHA-256 / Verification |
| :--- | :--- | :--- | :--- |
| **Signed R8 Release APK** | `release-artifacts/v2.2.0/omnidoc-studio-v2.2.0.apk` | **`3,271,703` bytes (`3.12 MB`)** | `036fc11c2e223fc67e776641e5f63346d8144c40dd81f20573f41049fe32e3b2` (`apksigner verify`: `Verifies`, v1+v2 signed) |
| **Signed R8 App Bundle (AAB)** | `release-artifacts/v2.2.0/omnidoc-studio-v2.2.0.aab` | **`4,076,727` bytes (`3.89 MB`)** | `f19f4f89738366e2d288fcb77b45141837581f6970b78e4c52c759dfd80b8b60` (`jarsigner -verify`: `jar verified.`) |

**Signer Certificate (`apksigner verify --print-certs`):**
- DN: `CN=OmniDoc Studio Mobile, OU=Mobile Engineering, O=OmniDoc Studio, L=Bengaluru, ST=KA, C=IN`
- SHA-256 Digest: `fb82c807d4b6fd61a2ff0ac981324e15bfb5a328ad54cd594d019cd588ad4f48`

---

## 2. Generating & Verifying an Upload Keystore (External to Repo)

```powershell
$ksDir = Join-Path $env:USERPROFILE '.omnidoc-signing'
New-Item -ItemType Directory -Force -Path $ksDir | Out-Null
& 'C:\Users\Dell\.gradle\jdks\temurin-21\jdk-21.0.13+9\bin\keytool.exe' -genkeypair -v `
  -keystore (Join-Path $ksDir 'omnidoc-release.jks') `
  -storetype PKCS12 -alias omnidocrelease -keyalg RSA -keysize 2048 -validity 10000
```

Configure `android/app/build.gradle` signing automatically via environment variables (no untracked file edits needed):
- `OMNIDOC_KEYSTORE_FILE`
- `OMNIDOC_KEYSTORE_PASSWORD`
- `OMNIDOC_KEY_ALIAS`
- `OMNIDOC_KEY_PASSWORD`

Verify cryptographic signatures after building:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --verbose --print-certs android\app\build\outputs\apk\release\app-release.apk
& "C:\Users\Dell\.gradle\jdks\temurin-21\jdk-21.0.13+9\bin\jarsigner.exe" -verify android\app\build\outputs\bundle\release\app-release.aab
```

---

## 3. GitHub Actions CI/CD Workflows

- [`.github/workflows/mobile-ci.yml`](.github/workflows/mobile-ci.yml):
  1. `frontend-and-security`: Runs `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm audit --omit=dev`.
  2. `postgres-and-storage-integration`: Provisions a live `postgres:16-alpine` service container and runs `pytest tests/test_postgres_and_storage_integration.py tests/test_ai_consent_and_mobile_code.py tests/test_supabase_storage.py -v` with `TEST_DATABASE_URL=postgresql+asyncpg://...`.
- [`.github/workflows/android-build.yml`](.github/workflows/android-build.yml):
  1. `android-compile-and-unit-test`: Builds Vite assets, runs `npx cap sync android`, executes `./gradlew --no-daemon testDebugUnitTest assembleDebug assembleDebugAndroidTest`, and uploads APK artifacts.
  2. `android-emulator-instrumented`: Runs `./gradlew --no-daemon connectedDebugAndroidTest` on `reactivecircus/android-emulator-runner@v2` (API 34).

---

## 4. Production App Links Note (`assetlinks.json`)

`AndroidManifest.xml` declares `android:autoVerify="true"` for `https://omnidoc-studio-jet.vercel.app/mobile`. To enable system-verified App Link auto-opening without disambiguation dialogs on physical devices, ensure `https://omnidoc-studio-jet.vercel.app/.well-known/assetlinks.json` serves the production signing certificate's SHA-256 fingerprint (`fb82c807d4b6fd61a2ff0ac981324e15bfb5a328ad54cd594d019cd588ad4f48` for this upload cert, or the Play App Signing key fingerprint once enrolled in Play Console).
