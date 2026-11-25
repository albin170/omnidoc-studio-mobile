# Release, Signing & Installation Guide

> **Policy Notice:** Do **not** publish builds to Google Play Store without explicit authorization. Release artifacts below are generated locally for testing and signed distribution preparation.

---

## 1. Generated Build Artifacts

All builds below succeeded via Gradle 9.7.1 + AGP 8.7.2 + Temurin JDK 21 (`21.0.13+9`):

| Artifact | Path | Size |
| :--- | :--- | :--- |
| Debug APK | `android/app/build/outputs/apk/debug/app-debug.apk` | `7,948,851` bytes (`7.58 MB`) |
| Release APK (unsigned) | `android/app/build/outputs/apk/release/app-release-unsigned.apk` | `6,408,359` bytes (`6.11 MB`) |
| Release App Bundle (AAB) | `android/app/build/outputs/bundle/release/app-release.aab` | `5,781,841` bytes (`5.51 MB`) |

---

## 2. Generating a Release Upload Keystore

Create an upload keystore **outside** git tracking (never commit `.jks` or `keystore.properties`):

```powershell
keytool -genkeypair -v `
  -keystore android\omnidoc-release.jks `
  -alias omnidoc-upload `
  -keyalg RSA -keysize 2048 -validity 10000
```

Then copy the template and fill in your credentials:

```powershell
Copy-Item android\keystore.properties.example android\keystore.properties
```

`android/keystore.properties` (git-ignored):

```properties
storeFile=omnidoc-release.jks
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=omnidoc-upload
keyPassword=YOUR_KEY_PASSWORD
```

Alternatively, pass signing credentials via CI/CD environment variables:
`OMNIDOC_KEYSTORE_FILE`, `OMNIDOC_KEYSTORE_PASSWORD`, `OMNIDOC_KEY_ALIAS`, `OMNIDOC_KEY_PASSWORD`.

---

## 3. Building Signed Release APK & AAB

Once `android/keystore.properties` (or env vars) is present, `android/app/build.gradle` automatically signs both release targets:

```bash
npm run cap:sync
npm run android:release
npm run android:bundle
```

Verify APK signature using Android Build-Tools `apksigner`:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.1.0\apksigner.bat" verify --verbose android\app\build\outputs\apk\release\app-release.apk
```

---

## 4. Installing on Emulator or Physical Android Device

Enable **USB Debugging** on the device (or start an AVD in Android Studio), then install the debug APK:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Launch the app:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell am start -n studio.omnidoc.mobile/.MainActivity
```

---

## 5. Play Store Pre-Flight Checklist (When Authorized)

1. Increment `versionCode` and `versionName` in `android/app/build.gradle`.
2. Build signed AAB (`npm run android:bundle`).
3. Verify `VITE_APP_ENV=production` and `VITE_API_BASE_URL=https://omnidoc-studio-jet.vercel.app/api/v1`.
4. Confirm `android:allowBackup="false"` and `cleartextTrafficPermitted="false"` in `AndroidManifest.xml` / `network_security_config.xml`.
5. Complete Google Play Data Safety declaration matching OmniDoc Studio's consent records (`2026.1`).
