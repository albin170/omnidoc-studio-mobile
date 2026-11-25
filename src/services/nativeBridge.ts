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
}): () => void {
  const handles: Array<{ remove: () => Promise<void> }> = [];

  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      handlers.onResume?.();
    } else {
      handlers.onBackground?.();
    }
  })
    .then((h) => handles.push(h))
    .catch(() => {});

  if (handlers.onBackButton) {
    App.addListener('backButton', () => {
      handlers.onBackButton?.();
    })
      .then((h) => handles.push(h))
      .catch(() => {});
  }

  return () => {
    handles.forEach((h) => h.remove().catch(() => {}));
  };
}
