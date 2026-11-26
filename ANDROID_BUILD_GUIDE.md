# OmniDoc Studio Mobile — Android Build & Emulator Guide

**App ID:** `studio.omnidoc.mobile`  
**Android Toolchain Verified:** Gradle `9.7.1` · Android Gradle Plugin `8.7.2` · `compileSdk 35` · `targetSdk 35` · `minSdk 23`

---

## 1. Prerequisites & Verified Workstation Paths

| Tool | Required Version | Verified Path / Version |
| :--- | :--- | :--- |
| Node.js | 20+ (LTS) | `v24.16.0` |
| JDK | Eclipse Temurin JDK 21 (`21.0.13+9`) | `C:\Users\Dell\.gradle\jdks\temurin-21\jdk-21.0.13+9` |
| Android SDK | Platform 35+, Build-Tools 34/36+ | `C:\Users\Dell\AppData\Local\Android\Sdk` |
| Gradle Wrapper | `9.7.1` | `android/gradlew.bat` |

> **JDK 21 Toolchain Note:** `android/settings.gradle` enables `org.gradle.toolchains.foojay-resolver-convention` `1.0.0`. On Windows PowerShell, set `JAVA_HOME` to Eclipse Temurin JDK 21 (`jdk-21.0.13+9`) and `ANDROID_HOME` to the Android SDK directory before invoking Gradle.

---

## 2. Environment Setup (PowerShell)

```powershell
$env:JAVA_HOME = 'C:\Users\Dell\.gradle\jdks\temurin-21\jdk-21.0.13+9'
$env:ANDROID_HOME = 'C:\Users\Dell\AppData\Local\Android\Sdk'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
```

---

## 3. Web Build & Capacitor Android Sync

```bash
npm install
npm run typecheck
npm run build
npx cap sync android
```

`npx cap sync android` copies `dist/` into `android/app/src/main/assets/public/` and updates the 9 Capacitor plugins (`@capacitor/app`, `@capacitor/camera`, `@capacitor/filesystem`, `@capacitor/haptics`, `@capacitor/network`, `@capacitor/preferences`, `@capacitor/share`, `@capacitor/splash-screen`, `@capacitor/status-bar`).

To regenerate adaptive launcher icons and splash drawables:

```bash
npm run icons:generate
```

---

## 4. Gradle CLI Build & Unit Tests

Run all Android unit tests, Debug APK, Release APK, and Release App Bundle (AAB):

```powershell
cd android
.\gradlew.bat --no-daemon --console=plain testDebugUnitTest assembleDebug assembleRelease bundleRelease
```

Verified output (`BUILD SUCCESSFUL`, 804 actionable tasks):
- `testDebugUnitTest`: `2/2` JUnit tests passed (`ExampleUnitTest`, `SecureVaultLogicTest`).
- `assembleDebug`: `android/app/build/outputs/apk/debug/app-debug.apk` (`8,328,910` bytes / `7.94 MB`)
- `assembleRelease`: `android/app/build/outputs/apk/release/app-release-unsigned.apk` (`6,508,722` bytes / `6.21 MB`)
- `bundleRelease`: `android/app/build/outputs/bundle/release/app-release.aab` (`5,882,244` bytes / `5.61 MB`)

Convenience npm scripts from repository root:
- `npm run cap:sync`
- `npm run android:debug`
- `npm run android:release`
- `npm run android:bundle`

---

## 5. Android Studio & Emulator Setup

1. Open `c:\Users\Dell\Documents\omnidoc-studio-mobile\android` in Android Studio (`npx cap open android`).
2. Allow Gradle sync to finish using JDK 21.
3. Open **Tools -> Device Manager** and create a virtual device (recommended: Pixel 7 / API 35 Google APIs x86_64).
4. Click **Run** (`Shift + F10`) to deploy `app-debug.apk`.
5. For local backend testing on the host workstation (`127.0.0.1:8000`), select **Development** (`http://10.0.2.2:8000/api/v1`) inside **Account Settings** or **AuthScreen -> Server Config**, or forward via `adb reverse tcp:8000 tcp:8000`.
6. To test deep links on an emulator or USB-debugged device:
   ```powershell
   adb shell am start -a android.intent.action.VIEW -d "omnidoc://pdf" studio.omnidoc.mobile
   ```
