# Android Build & Emulator Setup Guide

## 1. Prerequisites

| Tool | Required Version | Verified Local Path |
| :--- | :--- | :--- |
| Node.js | 20+ (LTS) | `v24.16.0` |
| JDK | **Eclipse Temurin JDK 21** (`21.0.13+9`) | `C:\Users\Dell\.gradle\jdks\temurin-21\jdk-21.0.13+9` |
| Android SDK | Platform 35 / 36.1, Build-Tools 34 / 36 / 37 | `C:\Users\Dell\AppData\Local\Android\Sdk` |
| Android Studio | Installed | `C:\Program Files\Android\Android Studio` |

> **JDK Note:** Android Gradle Plugin 8.7.2 + Capacitor 7 require JDK 21 for Java toolchain compilation. On this workstation, Android Studio's bundled `jbr\bin\java.exe` hung when invoked from non-interactive PowerShell, so Eclipse Temurin JDK 21 (`jdk-21.0.13+9`) is provisioned and verified for CLI builds, and `foojay-resolver-convention` `1.0.0` is enabled in `android/settings.gradle`.

---

## 2. Environment Variables (PowerShell)

```powershell
$env:JAVA_HOME = "$env:USERPROFILE\.gradle\jdks\temurin-21\jdk-21.0.13+9"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
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
.\gradlew.bat --no-daemon testDebugUnitTest assembleDebug assembleRelease bundleRelease
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
   - Note: This workstation currently has `emulator.exe` and `adb.exe` installed, with `0` AVDs and `0` attached devices (`adb devices` empty, `system-images/` not yet downloaded). Android Studio Device Manager will download the system image on first AVD creation.
4. Click **Run** (`Shift + F10`) to install and launch `app-debug.apk`.
5. To connect to a locally running OmniDoc FastAPI backend on the host machine (`127.0.0.1:8000`), choose **Development** environment in the app (`http://10.0.2.2:8000/api/v1`) or forward via `adb reverse tcp:8000 tcp:8000`.
