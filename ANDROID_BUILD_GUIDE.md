# OmniDoc Studio Mobile — Android Build & Emulator Guide

**App ID:** `studio.omnidoc.mobile` · **Version:** `2.1.0` (`versionCode: 2`)  
**Android Toolchain Verified:** Gradle `9.7.1` · AGP `8.7.2` · `compileSdk 35` · `targetSdk 35` · `minSdk 23`

---

## 1. Prerequisites & Verified Workstation Paths

| Tool | Required Version | Verified Path / Version |
| :--- | :--- | :--- |
| Node.js | 20+ (LTS) | `v24.16.0` |
| JDK | Eclipse Temurin JDK 21 (`21.0.13+9`) | `C:\Users\Dell\.gradle\jdks\temurin-21\jdk-21.0.13+9` |
| Android SDK | Platform 35, Build-Tools `36.0.0` | `C:\Users\Dell\AppData\Local\Android\Sdk` |
| Gradle Wrapper | `9.7.1` | `android/gradlew.bat` |

> **JDK Note on Windows:** Do **not** point `JAVA_HOME` to Android Studio's bundled `jbr` when running headless PowerShell Gradle commands; always use Eclipse Temurin JDK 21 (`C:\Users\Dell\.gradle\jdks\temurin-21\jdk-21.0.13+9`). `android/build.gradle` enforces `org.jetbrains.kotlin:kotlin-stdlib*:1.8.22` across all subprojects so `:capacitor-cordova-android-plugins:checkDebugAndroidTestDuplicateClasses` compiles cleanly.

---

## 2. Environment Setup (PowerShell)

```powershell
$env:JAVA_HOME = 'C:\Users\Dell\.gradle\jdks\temurin-21\jdk-21.0.13+9'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
```

---

## 3. Web Quality Gates, Build & Capacitor Android Sync

```powershell
npm install
npm run typecheck
npm run lint
npm test
npm run build
npx cap sync android
```

---

## 4. Gradle CLI Tests, Debug/AndroidTest & Signed Release Build

```powershell
cd android
$env:OMNIDOC_KEYSTORE_FILE = "$env:USERPROFILE\.omnidoc-signing\omnidoc-release.jks"
$env:OMNIDOC_KEYSTORE_PASSWORD = '<YOUR_KEYSTORE_PASSWORD>'
$env:OMNIDOC_KEY_ALIAS = 'omnidocrelease'
$env:OMNIDOC_KEY_PASSWORD = '<YOUR_KEY_PASSWORD>'
.\gradlew.bat --no-daemon testDebugUnitTest assembleDebug assembleDebugAndroidTest assembleRelease bundleRelease
```

### Verified Outputs (`v2.1.0`, `BUILD SUCCESSFUL`)
- `testDebugUnitTest`: **4/4** JUnit tests passed (`ExampleUnitTest` 1 + `SecureVaultLogicTest` 3 AES-256-GCM crypto tests; 0 failures, 0 errors, 0 skipped).
- `assembleDebug`: `android/app/build/outputs/apk/debug/app-debug.apk` (**`8,208,368` bytes** / `7.83 MB`)
- `assembleDebugAndroidTest`: `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk` (**`563,768` bytes** / `550.55 KB`, containing `MainActivityInstrumentedTest` + `ExampleInstrumentedTest`)
- `assembleRelease`: `android/app/build/outputs/apk/release/app-release.apk` (**`6,656,312` bytes** / `6.35 MB`, signed v1 + v2)
- `bundleRelease`: `android/app/build/outputs/bundle/release/app-release.aab` (**`5,999,438` bytes** / `5.72 MB`, `jarsigner -verify` verified)

---

## 5. Emulator / Device Testing & GitHub Actions Runner

- **Local Workstation Status:** `adb.exe` and `emulator.exe` exist locally, but no Android AVD system image is downloaded locally (`emulator -list-avds` empty). Create a **Pixel 6 / Pixel 7 (API 34+)** AVD in Android Studio Device Manager or attach a USB-debugging handset to run `connectedDebugAndroidTest` locally.
- **Automated CI Emulator Verification:** `.github/workflows/android-build.yml` runs `./gradlew --no-daemon connectedDebugAndroidTest` on `reactivecircus/android-emulator-runner@v2` (API 34, `arm64-v8a`, `pixel_6`).
- **Deep Link Testing via ADB:**
  ```powershell
  adb shell am start -a android.intent.action.VIEW -d "omnidoc://workspaces" studio.omnidoc.mobile
  ```
