import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(process.cwd());
const IOS_APP_DIR = path.join(ROOT, 'ios', 'App', 'App');
const PBXPROJ_PATH = path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const INFO_PLIST_PATH = path.join(IOS_APP_DIR, 'Info.plist');
const MAIN_STORYBOARD_PATH = path.join(IOS_APP_DIR, 'Base.lproj', 'Main.storyboard');
const APP_ICON_PATH = path.join(IOS_APP_DIR, 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');

// 1. Update Info.plist with permissions, file sharing, version keys & omnidoc:// scheme
const infoPlistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDevelopmentRegion</key>
\t<string>en</string>
\t<key>CFBundleDisplayName</key>
\t<string>OmniDoc Studio</string>
\t<key>CFBundleExecutable</key>
\t<string>$(EXECUTABLE_NAME)</string>
\t<key>CFBundleIdentifier</key>
\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>$(PRODUCT_NAME)</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>CFBundleShortVersionString</key>
\t<string>$(MARKETING_VERSION)</string>
\t<key>CFBundleVersion</key>
\t<string>$(CURRENT_PROJECT_VERSION)</string>
\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>studio.omnidoc.mobile</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>omnidoc</string>
\t\t\t</array>
\t\t</dict>
\t</array>
\t<key>ITSAppUsesNonExemptEncryption</key>
\t<false/>
\t<key>LSRequiresIPhoneOS</key>
\t<true/>
\t<key>LSSupportsOpeningDocumentsInPlace</key>
\t<true/>
\t<key>NSCameraUsageDescription</key>
\t<string>OmniDoc Studio uses the camera to scan paper documents directly into PDFs and OCR workflows.</string>
\t<key>NSPhotoLibraryAddUsageDescription</key>
\t<string>OmniDoc Studio saves exported document images and scanned pages to your Photo Library when requested.</string>
\t<key>NSPhotoLibraryUsageDescription</key>
\t<string>OmniDoc Studio imports selected images for PDF conversion, compression, and OCR processing.</string>
\t<key>UIFileSharingEnabled</key>
\t<true/>
\t<key>UILaunchStoryboardName</key>
\t<string>LaunchScreen</string>
\t<key>UIMainStoryboardFile</key>
\t<string>Main</string>
\t<key>UIRequiredDeviceCapabilities</key>
\t<array>
\t\t<string>arm64</string>
\t</array>
\t<key>UISupportedInterfaceOrientations</key>
\t<array>
\t\t<string>UIInterfaceOrientationPortrait</string>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t\t<string>UIInterfaceOrientationLandscapeRight</string>
\t</array>
\t<key>UISupportedInterfaceOrientations~ipad</key>
\t<array>
\t\t<string>UIInterfaceOrientationPortrait</string>
\t\t<string>UIInterfaceOrientationPortraitUpsideDown</string>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t\t<string>UIInterfaceOrientationLandscapeRight</string>
\t</array>
\t<key>UIViewControllerBasedStatusBarAppearance</key>
\t<true/>
</dict>
</plist>
`;
fs.writeFileSync(INFO_PLIST_PATH, infoPlistContent, 'utf8');

// 2. Point Main.storyboard root ViewController to OmniDocBridgeViewController (registers SecureVaultPlugin)
if (fs.existsSync(MAIN_STORYBOARD_PATH)) {
  let sb = fs.readFileSync(MAIN_STORYBOARD_PATH, 'utf8');
  sb = sb.replace(
    'customClass="CAPBridgeViewController" customModule="Capacitor"',
    'customClass="OmniDocBridgeViewController" customModule="App"'
  );
  fs.writeFileSync(MAIN_STORYBOARD_PATH, sb, 'utf8');
}

// 3. Patch project.pbxproj cleanly with SecureVaultPlugin.swift, OmniDocBridgeViewController.swift,
//    App.entitlements, MARKETING_VERSION=2.2.0, CURRENT_PROJECT_VERSION=3, IPHONEOS_DEPLOYMENT_TARGET=15.0
let pbx = fs.readFileSync(PBXPROJ_PATH, 'utf8');

if (!pbx.includes('SecureVaultPlugin.swift')) {
  pbx = pbx.replace(
    '/* End PBXBuildFile section */',
    `\t\tA10000012026000100000001 /* SecureVaultPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = A10000022026000100000001 /* SecureVaultPlugin.swift */; };\n\t\tA10000012026000100000002 /* OmniDocBridgeViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = A10000022026000100000002 /* OmniDocBridgeViewController.swift */; };\n/* End PBXBuildFile section */`
  );
  pbx = pbx.replace(
    '/* End PBXFileReference section */',
    `\t\tA10000022026000100000001 /* SecureVaultPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SecureVaultPlugin.swift; sourceTree = "<group>"; };\n\t\tA10000022026000100000002 /* OmniDocBridgeViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = OmniDocBridgeViewController.swift; sourceTree = "<group>"; };\n\t\tA10000022026000100000003 /* App.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = App.entitlements; sourceTree = "<group>"; };\n/* End PBXFileReference section */`
  );
  pbx = pbx.replace(
    '504EC3071FED79650016851F /* AppDelegate.swift */,',
    `504EC3071FED79650016851F /* AppDelegate.swift */,\n\t\t\t\tA10000022026000100000001 /* SecureVaultPlugin.swift */,\n\t\t\t\tA10000022026000100000002 /* OmniDocBridgeViewController.swift */,\n\t\t\t\tA10000022026000100000003 /* App.entitlements */,`
  );
  pbx = pbx.replace(
    '504EC3081FED79650016851F /* AppDelegate.swift in Sources */,',
    `504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n\t\t\t\tA10000012026000100000001 /* SecureVaultPlugin.swift in Sources */,\n\t\t\t\tA10000012026000100000002 /* OmniDocBridgeViewController.swift in Sources */,`
  );
}

pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, 'MARKETING_VERSION = 2.2.0;');
pbx = pbx.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, 'CURRENT_PROJECT_VERSION = 3;');
pbx = pbx.replace(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;');

if (!pbx.includes('CODE_SIGN_ENTITLEMENTS')) {
  pbx = pbx.replace(
    /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/g,
    'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;'
  );
}

fs.writeFileSync(PBXPROJ_PATH, pbx, 'utf8');

// 4. Generate crisp 1024x1024 opaque iOS AppIcon PNG (App Store requires no alpha channel)
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}
const size = 1024;
const stride = size * 3 + 1;
const raw = Buffer.alloc(stride * size);
for (let y = 0; y < size; y++) {
  raw[y * stride] = 0;
  const ny = y / size;
  for (let x = 0; x < size; x++) {
    const nx = x / size;
    // Deep navy gradient background (#070D1B -> #0F172A) + ice-blue glow
    let r = Math.round(7 + ny * 8);
    let g = Math.round(13 + ny * 12);
    let b = Math.round(27 + ny * 19);

    const dist = Math.hypot(nx - 0.5, ny - 0.48);
    if (dist < 0.36) {
      const k = 1 - dist / 0.36;
      r = Math.min(255, Math.round(r + k * 24));
      g = Math.min(255, Math.round(g + k * 82));
      b = Math.min(255, Math.round(b + k * 145));
    }
    // Minimalist rounded document card in center with ice-blue top bar
    if (nx >= 0.30 && nx <= 0.70 && ny >= 0.22 && ny <= 0.78) {
      const inFold = nx > 0.58 && ny < 0.34 && nx - 0.58 > ny - 0.22;
      if (!inFold) {
        r = 226;
        g = 240;
        b = 255;
        if (nx >= 0.36 && nx <= 0.62 && ((ny >= 0.38 && ny <= 0.42) || (ny >= 0.48 && ny <= 0.52) || (ny >= 0.58 && ny <= 0.62 && nx <= 0.53))) {
          r = 56;
          g = 189;
          b = 248;
        }
      }
    }
    const p = y * stride + 1 + x * 3;
    raw[p] = r;
    raw[p + 1] = g;
    raw[p + 2] = b;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 2; // RGB opaque (no alpha, Apple App Store compliant)
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;
const compressed = zlib.deflateSync(raw, { level: 6 });
const iconPng = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(APP_ICON_PATH, iconPng);
console.log('Configured iOS Xcode project, Info.plist, App.entitlements, Main.storyboard, and 1024x1024 AppIcon.');
