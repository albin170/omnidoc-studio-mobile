# Android Build & Emulator Setup Guide

## 1. Prerequisites

| Tool | Required Version | Verified Local Path |
| :--- | :--- | :--- |
| Node.js | 20+ (LTS) | `v24.16.0` |
| JDK | **JDK 21** (Android Studio JBR) | `C:\Program Files\Android\Android Studio\jbr` (`21.0.10`) |
| Android SDK | Platform 35 / 36, Build-Tools 36+ | `C:\Users\Dell\AppData\Local\Android\Sdk` |
| Android Studio | Ladybug / Meerkat or newer | `C:\Program Files\Android\Android Studio` |

> **Important JDK Note:** Android Gradle Plugin (AGP) requires JDK 17 or JDK 21. Always point `JAVA_HOME` to Android Studio's bundled JBR (`21.0.10`) if your system `PATH` points to JDK 27.

---

## 2. Environment Variables (PowerShell)

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "C:\Users\Dell\AppData\Local\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
```

---

## 3. Build Web Bundle & Sync Capacitor

```bash
npm install
npm run build
npx cap sync android
```

To regenerate launcher icons and splash screens:

```bash
npm run icons:generate
```

---

## 4. Building from CLI (Gradle)

```powershell
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleDebug
.\gradlew.bat assembleRelease
.\gradlew.bat bundleRelease
```

Or using npm scripts from repository root:

```bash
npm run android:debug
npm run android:release
npm run android:bundle
```

---

## 5. Running in Android Studio & Emulator

1. Open `omnidoc-studio-mobile/android` in Android Studio (`npx cap open android`).
2. Wait for Gradle Sync to complete.
3. Open **Device Manager** (`Tools -> Device Manager`) and create/start an AVD (recommended: Pixel 7 / API 35 Google APIs x86_64).
   - Note: If the host machine has no AVD system image downloaded yet, Device Manager downloads it automatically on first AVD creation.
4. Click **Run** (`Shift + F10`) to install and launch `app-debug.apk`.
5. To connect to a locally running OmniDoc FastAPI backend on the host machine (`127.0.0.1:8000`), choose **Development** environment in the app (`http://10.0.2.2:8000/api/v1`) or forward via `adb reverse tcp:8000 tcp:8000`.
