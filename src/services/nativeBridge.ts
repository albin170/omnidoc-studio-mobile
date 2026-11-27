import { App } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Network } from '@capacitor/network';
import { Share } from '@capacitor/share';

export interface CapturedPhoto {
  bytes: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png';
  filename: string;
  previewUrl: string;
}

export interface DeepLinkEvent {
  rawUrl: string;
  scheme: string;
  host: string;
  path: string;
  params: Record<string, string>;
  redirectUri: string;
  securityWarning?: string;
}

const ALLOWED_DEEP_LINK_HOSTS = new Set([
  'auth',
  'home',
  'dashboard',
  'docs',
  'library',
  'documents',
  'pdf',
  'pdf_studio',
  'convert',
  'conversion_studio',
  'word',
  'word_studio',
  'slides',
  'slides_studio',
  'sheets',
  'sheets_studio',
  'ocr',
  'ocr_studio',
  'studios',
  'studios_hub',
  'workspaces',
  'project',
  'projects',
  'history',
  'notifications',
  'settings',
  'admin',
  'ai',
  'ai_assistant',
]);

const SENSITIVE_DEEP_LINK_PARAMS = new Set(['access_token', 'token', 'jwt', 'refresh_token', 'secret']);

/**
 * Parses verified HTTPS App Links (`https://omnidoc-studio-jet.vercel.app/mobile/...`)
 * and `omnidoc://` deep links against a strict route allowlist.
 * Rejects any deep link carrying reusable tokens/JWTs in query or hash fragments.
 */
export function parseDeepLinkUrl(rawUrl: string): DeepLinkEvent | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const trimmed = rawUrl.trim();
    const parsed = new URL(trimmed);
    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();

    let host = '';
    let path = '/';
    let redirectUri = trimmed.split('?')[0].split('#')[0];

    if (scheme === 'https') {
      if (parsed.hostname.toLowerCase() !== 'omnidoc-studio-jet.vercel.app') {
        return null;
      }
      if (!parsed.pathname.toLowerCase().startsWith('/mobile')) {
        return null;
      }
      const subPath = parsed.pathname.slice('/mobile'.length).replace(/^\/+/, '');
      const segments = subPath.split('/').filter(Boolean);
      host = (segments[0] || 'home').toLowerCase();
      path = segments.length > 1 ? `/${segments.slice(1).join('/')}` : '/';
    } else if (scheme === 'omnidoc') {
      host = parsed.hostname.toLowerCase();
      path = parsed.pathname || '/';
    } else {
      return null;
    }

    if (!ALLOWED_DEEP_LINK_HOSTS.has(host)) {
      return null;
    }

    // Reject reusable tokens embedded in query parameters or fragments
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    for (const sensitiveKey of SENSITIVE_DEEP_LINK_PARAMS) {
      if (parsed.searchParams.has(sensitiveKey) || hashParams.has(sensitiveKey)) {
        return {
          rawUrl: trimmed,
          scheme,
          host: 'rejected',
          path: '/',
          params: {},
          redirectUri,
          securityWarning: 'Rejected insecure deep link containing embedded token parameters.',
        };
      }
    }

    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      if (!SENSITIVE_DEEP_LINK_PARAMS.has(key.toLowerCase())) {
        params[key] = value;
      }
    });

    return {
      rawUrl: trimmed,
      scheme,
      host,
      path,
      params,
      redirectUri,
    };
  } catch {
    return null;
  }
}

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export async function hapticTap(style: 'light' | 'medium' = 'light'): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await Haptics.impact({ style: style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
  } catch {
    // ignore haptics unavailable
  }
}

export async function captureDocumentPhoto(source: 'camera' | 'prompt' = 'prompt'): Promise<CapturedPhoto> {
  const photo = await Camera.getPhoto({
    quality: 88,
    allowEditing: false,
    resultType: CameraResultType.Base64,
    source: source === 'camera' ? CameraSource.Camera : CameraSource.Prompt,
    correctOrientation: true,
  });

  if (!photo.base64String) {
    throw new Error('No image data returned from camera.');
  }

  const fmt = (photo.format || 'jpeg').toLowerCase() === 'png' ? 'png' : 'jpeg';
  const mimeType: 'image/jpeg' | 'image/png' = fmt === 'png' ? 'image/png' : 'image/jpeg';
  const bytes = base64ToUint8Array(photo.base64String);
  const filename = `scan_${Date.now()}.${fmt === 'png' ? 'png' : 'jpg'}`;

  return {
    bytes,
    mimeType,
    filename,
    previewUrl: `data:${mimeType};base64,${photo.base64String}`,
  };
}

export async function saveFileToDevice(blob: Blob, filename: string): Promise<{ path: string; uri?: string }> {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_');

  if (isNativePlatform()) {
    const base64Data = await blobToBase64(blob);
    const relPath = `OmniDoc/${safeName}`;
    try {
      await Filesystem.mkdir({
        path: 'OmniDoc',
        directory: Directory.Documents,
        recursive: true,
      });
    } catch {
      // directory may already exist
    }
    const res = await Filesystem.writeFile({
      path: relPath,
      data: base64Data,
      directory: Directory.Documents,
      recursive: true,
    });
    return { path: `Documents/${relPath}`, uri: res.uri };
  }

  // Browser fallback download
  if (typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { path: safeName };
}

export async function shareDocumentFile(blob: Blob, filename: string, title = 'Share Document'): Promise<void> {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_');

  if (isNativePlatform()) {
    const base64Data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({
      path: safeName,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({
      title,
      text: `Shared from OmniDoc Studio Mobile: ${safeName}`,
      url: res.uri,
      dialogTitle: title,
    });
    return;
  }

  if (typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function') {
    const file = new File([blob], safeName, { type: blob.type || 'application/octet-stream' });
    if (!(navigator as any).canShare || (navigator as any).canShare({ files: [file] })) {
      await (navigator as any).share({ title, files: [file] });
      return;
    }
  }

  // Web fallback: save file locally
  await saveFileToDevice(blob, safeName);
}

export async function getNetworkConnected(): Promise<boolean> {
  try {
    const status = await Network.getStatus();
    return status.connected;
  } catch {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }
}

export function subscribeNetworkChanges(onChange: (connected: boolean) => void): () => void {
  let handle: { remove: () => Promise<void> } | null = null;
  let active = true;

  Network.addListener('networkStatusChange', (status) => {
    if (active) onChange(status.connected);
  })
    .then((h) => {
      handle = h;
    })
    .catch(() => {});

  const onOnline = () => active && onChange(true);
  const onOffline = () => active && onChange(false);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }

  return () => {
    active = false;
    handle?.remove().catch(() => {});
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    }
  };
}

export function registerAppLifecycle(handlers: {
  onResume?: () => void;
  onBackground?: () => void;
  onBackButton?: () => void;
  onAppUrlOpen?: (event: DeepLinkEvent) => void;
}): () => void {
  const handles: Array<{ remove: () => Promise<void> }> = [];
  let active = true;

  App.addListener('appStateChange', ({ isActive }) => {
    if (!active) return;
    if (isActive) {
      handlers.onResume?.();
    } else {
      handlers.onBackground?.();
    }
  })
    .then((h) => {
      if (active) handles.push(h);
      else h.remove().catch(() => {});
    })
    .catch(() => {});

  if (handlers.onBackButton) {
    App.addListener('backButton', () => {
      if (active) handlers.onBackButton?.();
    })
      .then((h) => {
        if (active) handles.push(h);
        else h.remove().catch(() => {});
      })
      .catch(() => {});
  }

  if (handlers.onAppUrlOpen) {
    const handleIncomingUrl = (rawUrl?: string | null) => {
      if (!active || !rawUrl) return;
      const parsed = parseDeepLinkUrl(rawUrl);
      if (parsed) {
        handlers.onAppUrlOpen?.(parsed);
      }
    };

    App.addListener('appUrlOpen', (data) => {
      handleIncomingUrl(data?.url);
    })
      .then((h) => {
        if (active) handles.push(h);
        else h.remove().catch(() => {});
      })
      .catch(() => {});

    // Handle cold-start deep links when the app is launched from a closed state.
    App.getLaunchUrl()
      .then((launch) => handleIncomingUrl(launch?.url))
      .catch(() => {});
  }

  return () => {
    active = false;
    handles.forEach((h) => h.remove().catch(() => {}));
  };
}
