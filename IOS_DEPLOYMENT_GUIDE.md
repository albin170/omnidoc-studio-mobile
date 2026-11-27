# OmniDoc Studio Mobile — iOS Compatibility & Deployment Guide

**App ID / Bundle Identifier:** `studio.omnidoc.mobile` · **Version:** `2.2.0` (`CFBundleVersion: 3`) · **Minimum iOS:** `15.0`

---

## 1. Capacitor Plugin Compatibility Audit (`@capacitor/ios@^7.4.4`)

| Plugin / Component | iOS Compatibility | Implementation Status |
| :--- | :--- | :--- |
| `@capacitor/app` `7.1.2` | ✅ Full UIKit `application(_:open:options:)` + Universal Links | Configured in `App.entitlements` (`applinks:omnidoc-studio-jet.vercel.app`) & `Info.plist` (`omnidoc://`) |
| `@capacitor/camera` `7.0.5` | ✅ `UIImagePickerController` / PHPicker | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` configured in `Info.plist` |
| `@capacitor/filesystem` `7.1.9` | ✅ App Sandbox `Documents` & `Cache` directories | `UIFileSharingEnabled = true` and `LSSupportsOpeningDocumentsInPlace = true` configured |
| `@capacitor/share` `7.0.4` | ✅ `UIActivityViewController` | Native share sheet wired to chunked temp files |
| `@capacitor/preferences` `7.0.4` | ✅ `UserDefaults` | Stores non-sensitive UI preferences & encrypted WebCrypto `offlineStore` payloads |
| `@capacitor/network`, `haptics`, `splash-screen`, `status-bar` | ✅ All 4 officially supported on iOS 15+ | Synced via `npx cap sync ios` |
| `SecureVaultPlugin.swift` (`SecureVault`) | ✅ Custom Apple Security Keychain plugin | Created at `ios/App/App/SecureVaultPlugin.swift` (`kSecClassGenericPassword`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`) & registered by `OmniDocBridgeViewController.swift` |
| `CapacitorHttp` & `apiClient.ts` | ✅ Native `URLSession` networking | Uses shared FastAPI HTTPS API (`https://omnidoc-studio-jet.vercel.app/api/v1`) without browser CORS limits |

---

## 2. Current Build Status & Exact Apple Signing Requirements

- **Prepared in Repo (`ios/`):** Capacitor iOS platform added (`npx cap add ios`), native iOS Keychain vault implemented (`SecureVaultPlugin.swift`), `Info.plist` permissions/URL types/file-sharing configured, Associated Domains (`App.entitlements`) added, `1024x1024` opaque `AppIcon` generated, and [`.github/workflows/release-ios.yml`](.github/workflows/release-ios.yml) (`macos-14`) configured.
- **Honest Blockers for Signed `.ipa` & App Store / TestFlight Distribution:**
  1. **macOS + Xcode 15/16 Required:** `.ipa` archives cannot be built cleanly on Windows. Run on Apple macOS (`macos-14` GitHub runner or local Mac).
  2. **Apple Developer Program Membership (\$99/yr) & Signing Secrets:** Generating a distributable signed `.ipa` or TestFlight build requires configuring GitHub Actions secrets:
     - `APPLE_CERTIFICATE_P12_BASE64` (Apple Distribution `.p12` certificate)
     - `APPLE_CERTIFICATE_PASSWORD`
     - `APPLE_PROVISIONING_PROFILE_BASE64` (App Store Connect / Ad Hoc profile matching `studio.omnidoc.mobile`)
     - `APPLE_TEAM_ID`
     - Optional `APPLE_EXPORT_METHOD` (`app-store-connect` or `ad-hoc`)
- Unlike Android `.apk` sideloading, Apple iOS does not allow direct public `.ipa` installation from a website URL — iOS distribution **must** go through Apple **TestFlight**, **App Store**, or **Ad Hoc** provisioning for explicitly registered device UDIDs.
