import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Minimize2,
  Plus,
  Repeat,
  ScanText,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { createDocxBlob } from '../engines/docxService';
import { formatFileSize } from '../engines/formatDetector';
import { compressAndResizeImage, convertImageFormat, convertImageToPdf } from '../engines/imageService';
import { performMobileOcr, MobileOcrResult } from '../engines/ocrService';
import { imagesToPdf, renderPdfPagesToImages } from '../engines/pdfService';
import { apiClient } from '../services/apiClient';
import {
  captureDocumentPhoto,
  hapticTap,
  revokePreviewUrl,
  saveFileToDevice,
  shareDocumentFile,
} from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';

interface ScanPageItem {
  id: string;
  bytes: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png';
  filename: string;
  previewUrl: string;
}

export const OcrImageStudioScreen: React.FC<{
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}> = ({ onToast }) => {
  const { isOnline } = useAuth();
  const [activeMode, setActiveMode] = useState<'scan' | 'ocr' | 'image'>('scan');
  const [busy, setBusy] = useState(false);
  const [statusLabel, setStatusLabel] = useState('');

  // Multi-page scan queue
  const [scanPages, setScanPages] = useState<ScanPageItem[]>([]);
  const scanPagesRef = useRef<ScanPageItem[]>([]);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // OCR State
  const [ocrResult, setOcrResult] = useState<MobileOcrResult | null>(null);
  const [ocrSourceName, setOcrSourceName] = useState('');
  const ocrInputRef = useRef<HTMLInputElement>(null);

  // Image Studio State
  const [targetImgFormat, setTargetImgFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg');
  const [compressQuality, setCompressQuality] = useState(0.75);
  const [maxDim, setMaxDim] = useState(1600);
  const [compressionStats, setCompressionStats] = useState<{
    filename: string;
    originalSize: number;
    compressedSize: number;
    width: number;
    height: number;
    blob: Blob;
  } | null>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const pdfToImgInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scanPagesRef.current = scanPages;
  }, [scanPages]);

  useEffect(() => {
    return () => {
      scanPagesRef.current.forEach((p) => revokePreviewUrl(p.previewUrl));
    };
  }, []);

  const handleCaptureScanPage = async () => {
    try {
      const photo = await captureDocumentPhoto('camera');
      setScanPages((prev) => [
        ...prev,
        {
          id: `pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ...photo,
        },
      ]);
      await hapticTap('light');
    } catch (err: any) {
      if (!String(err?.message || '').toLowerCase().includes('cancel')) {
        onToast('error', err?.message || 'Camera capture failed');
      }
    }
  };

  const handleImportScanImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: ScanPageItem[] = [];
    for (const file of Array.from(files)) {
      const lower = file.name.toLowerCase();
      const mimeType: 'image/jpeg' | 'image/png' = lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const bytes = new Uint8Array(await file.arrayBuffer());
      const previewUrl =
        typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
      added.push({
        id: `pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        bytes,
        mimeType,
        filename: file.name,
        previewUrl,
      });
    }
    setScanPages((prev) => [...prev, ...added]);
  };

  const removeScanPage = (id: string) => {
    setScanPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) revokePreviewUrl(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const moveScanPage = (index: number, delta: -1 | 1) => {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= scanPages.length) return;
    const next = [...scanPages];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    setScanPages(next);
  };

  const exportScanPdf = async (dest: 'save' | 'share' | 'upload') => {
    if (scanPages.length === 0) return;
    setBusy(true);
    try {
      const pdfBytes = await imagesToPdf(
        scanPages.map((p) => ({ bytes: p.bytes, mimeType: p.mimeType }))
      );
      const outName = `OmniDoc_Scan_${Date.now()}.pdf`;
      const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });

      if (dest === 'save') {
        const saved = await saveFileToDevice(blob, outName);
        onToast('success', `Saved scanned PDF to ${saved.path}`);
      } else if (dest === 'share') {
        await shareDocumentFile(blob, outName, outName);
      } else {
        const uploaded = await apiClient.uploadDocument(new File([blob], outName, { type: 'application/pdf' }));
        onToast('success', `Uploaded "${uploaded.filename}" to shared vault.`);
      }

      await offlineStore.appendHistory({
        kind: 'camera_scan',
        title: `Multi-page scan (${scanPages.length} pages)`,
        sourceFormat: 'jpg',
        targetFormat: 'pdf',
        sizeBytes: blob.size,
        status: 'completed',
      });
      await hapticTap('medium');
    } catch (err: any) {
      onToast('error', err?.message || 'Scan export failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRunOcr = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setOcrSourceName(file.name);
    setStatusLabel('Preparing OCR pipeline...');
    try {
      const res = await performMobileOcr(file, {
        isOnline,
        onProgress: setStatusLabel,
      });
      setOcrResult(res);
      await offlineStore.appendHistory({
        kind: 'ocr_extract',
        title: `OCR: ${file.name} (${res.wordsCount} words)`,
        sourceFormat: file.name.split('.').pop() || 'img',
        targetFormat: 'txt',
        sizeBytes: new Blob([res.text]).size,
        status: 'completed',
        documentId: res.documentId,
      });
      await hapticTap('medium');
      onToast('success', `Extracted ${res.wordsCount} words via ${res.source === 'on_device_pdf' ? 'PDF text stream' : 'Cloud OCR'}.`);
    } catch (err: any) {
      onToast('error', err?.message || 'OCR extraction failed');
    } finally {
      setBusy(false);
      setStatusLabel('');
    }
  };

  const handleOptimizeImage = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await compressAndResizeImage(file, {
        maxDimension: maxDim,
        quality: compressQuality,
        format: targetImgFormat,
      });
      const base = file.name.replace(/\.[^/.]+$/, '');
      const ext = targetImgFormat === 'jpeg' ? 'jpg' : targetImgFormat;
      setCompressionStats({
        filename: `${base}_optimized.${ext}`,
        originalSize: res.originalSize,
        compressedSize: res.compressedSize,
        width: res.width,
        height: res.height,
        blob: res.blob,
      });
      await hapticTap('light');
      onToast(
        'success',
        `Optimized image: ${formatFileSize(res.originalSize)} → ${formatFileSize(res.compressedSize)}`
      );
    } catch (err: any) {
      onToast('error', err?.message || 'Image optimization failed');
    } finally {
      setBusy(false);
    }
  };

  const handleConvertPdfToImages = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const blobs = await renderPdfPagesToImages(bytes, 'png');
      const base = file.name.replace(/\.[^/.]+$/, '');
      if (blobs.length === 1) {
        const saved = await saveFileToDevice(blobs[0], `${base}_page_1.png`);
        onToast('success', `Rendered page 1 to ${saved.path}`);
      } else {
        for (let i = 0; i < Math.min(blobs.length, 10); i++) {
          await saveFileToDevice(blobs[i], `${base}_page_${i + 1}.png`);
        }
        onToast('success', `Saved ${Math.min(blobs.length, 10)} page PNG(s).`);
      }
      await offlineStore.appendHistory({
        kind: 'image_operation',
        title: `PDF to PNG (${blobs.length} page(s))`,
        sourceFormat: 'pdf',
        targetFormat: 'png',
        sizeBytes: blobs.reduce((s, b) => s + b.size, 0),
        status: 'completed',
      });
    } catch (err: any) {
      onToast('error', err?.message || 'PDF to image export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div className="grid grid-cols-3 gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
        {[
          { id: 'scan', label: 'Multi-Scan' },
          { id: 'ocr', label: 'OCR Text' },
          { id: 'image', label: 'Image Lab' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveMode(t.id as 'scan' | 'ocr' | 'image')}
            className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
              activeMode === t.id ? 'bg-indigo-600 text-white' : 'text-slate-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeMode === 'scan' && (
        <div className="space-y-3">
          <input
            ref={scanInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleImportScanImages(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleCaptureScanPage}
              className="h-11 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
            >
              <Camera className="w-4 h-4" /> Capture Page
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => scanInputRef.current?.click()}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4 text-cyan-400" /> Add Images
            </button>
          </div>

          {scanPages.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-1.5">
              <Camera className="w-8 h-8 mx-auto text-indigo-400" />
              <p className="text-sm font-semibold">Multi-Page Scanner Queue</p>
              <p className="text-xs text-slate-400">
                Capture camera pages or import images, reorder pages cleanly, and export a single PDF.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {scanPages.map((pg, idx) => (
                  <div
                    key={pg.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 flex items-center gap-3"
                  >
                    {pg.previewUrl ? (
                      <img
                        src={pg.previewUrl}
                        alt={pg.filename}
                        className="w-12 h-14 object-cover rounded-lg border border-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-14 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0">
                        <ImageIcon className="w-5 h-5 text-slate-500" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-100 truncate">
                        Page {idx + 1}: {pg.filename}
                      </p>
                      <p className="text-[11px] text-slate-400">{formatFileSize(pg.bytes.byteLength)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveScanPage(idx, -1)}
                        aria-label="Move page up"
                        className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300 disabled:opacity-30"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === scanPages.length - 1}
                        onClick={() => moveScanPage(idx, 1)}
                        aria-label="Move page down"
                        className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300 disabled:opacity-30"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeScanPage(pg.id)}
                        aria-label="Remove page"
                        className="w-8 h-8 rounded-lg bg-rose-950/60 flex items-center justify-center text-rose-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => exportScanPdf('save')}
                  className="h-10 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" /> Save PDF
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => exportScanPdf('share')}
                  className="h-10 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Share2 className="w-3.5 h-3.5 text-indigo-400" /> Share
                </button>
                <button
                  type="button"
                  disabled={busy || !isOnline}
                  onClick={() => exportScanPdf('upload')}
                  className="h-10 rounded-xl bg-emerald-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <Upload className="w-3.5 h-3.5" /> Upload
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {activeMode === 'ocr' && (
        <div className="space-y-3">
          <input
            ref={ocrInputRef}
            type="file"
            accept=".pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              void handleRunOcr(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => ocrInputRef.current?.click()}
            className="w-full h-12 rounded-2xl bg-indigo-600 text-xs font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <ScanText className="w-4 h-4" />
            {busy ? statusLabel || 'Processing OCR...' : 'Select Image or PDF for OCR'}
          </button>

          {!isOnline && (
            <p className="text-[11px] text-amber-300 bg-amber-950/50 border border-amber-500/30 rounded-xl p-2.5">
              Offline mode extracts selectable text streams from PDFs. Raster image OCR requires Cloud connectivity.
            </p>
          )}

          {ocrResult && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-300 truncate">{ocrSourceName}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-300">
                  {ocrResult.source === 'on_device_pdf' ? 'PDF Stream' : 'Cloud OCR'} · {ocrResult.wordsCount} words
                </span>
              </div>
              <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 whitespace-pre-wrap max-h-56 overflow-y-auto">
                {ocrResult.text}
              </pre>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(ocrResult.text).catch(() => {});
                    onToast('success', 'Copied extracted text.');
                  }}
                  className="h-9 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const blob = new Blob([ocrResult.text], { type: 'text/plain;charset=utf-8' });
                    const saved = await saveFileToDevice(blob, `${ocrSourceName || 'ocr'}.txt`);
                    onToast('success', `Saved to ${saved.path}`);
                  }}
                  className="h-9 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" /> .TXT
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const blob = await createDocxBlob(
                      ocrSourceName || 'OCR Extract',
                      ocrResult.text
                        .split('\n\n')
                        .filter(Boolean)
                        .map((text) => ({ type: 'paragraph', text }))
                    );
                    const saved = await saveFileToDevice(blob, `${ocrSourceName || 'ocr'}.docx`);
                    onToast('success', `Saved DOCX to ${saved.path}`);
                  }}
                  className="h-9 rounded-xl bg-indigo-600/25 border border-indigo-500/40 text-xs font-semibold text-indigo-200 flex items-center justify-center gap-1"
                >
                  <FileText className="w-3.5 h-3.5" /> .DOCX
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeMode === 'image' && (
        <div className="space-y-3">
          <input
            ref={imgInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              void handleOptimizeImage(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={pdfToImgInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              void handleConvertPdfToImages(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Minimize2 className="w-4 h-4 text-emerald-400" /> Compress &amp; Convert Image
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {(['jpeg', 'png', 'webp'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setTargetImgFormat(fmt)}
                  className={`py-2 rounded-lg text-xs font-semibold uppercase border ${
                    targetImgFormat === fmt
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
            <div className="space-y-1 text-xs text-slate-300">
              <div className="flex justify-between">
                <span>Quality: {Math.round(compressQuality * 100)}%</span>
                <span>Max dimension: {maxDim}px</span>
              </div>
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.05}
                value={compressQuality}
                onChange={(e) => setCompressQuality(Number(e.target.value))}
                className="w-full"
                aria-label="Compression quality"
              />
              <input
                type="range"
                min={800}
                max={2400}
                step={200}
                value={maxDim}
                onChange={(e) => setMaxDim(Number(e.target.value))}
                className="w-full"
                aria-label="Maximum dimension pixels"
              />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => imgInputRef.current?.click()}
              className="w-full h-10 rounded-xl bg-emerald-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
            >
              <Repeat className="w-4 h-4" /> Pick Image to Compress / Convert
            </button>
          </div>

          {compressionStats && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5 text-xs">
              <p className="font-semibold text-slate-100 truncate">{compressionStats.filename}</p>
              <p className="text-slate-400">
                {formatFileSize(compressionStats.originalSize)} →{' '}
                <strong className="text-emerald-300">{formatFileSize(compressionStats.compressedSize)}</strong> (
                {compressionStats.width}×{compressionStats.height})
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const saved = await saveFileToDevice(compressionStats.blob, compressionStats.filename);
                    onToast('success', `Saved to ${saved.path}`);
                  }}
                  className="h-9 rounded-xl bg-slate-800 font-semibold flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" /> Save Image
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const pdfBytes = await convertImageToPdf(compressionStats.blob);
                    const pdfBlob = new Blob([pdfBytes as any], { type: 'application/pdf' });
                    const saved = await saveFileToDevice(
                      pdfBlob,
                      `${compressionStats.filename.replace(/\.[^/.]+$/, '')}.pdf`
                    );
                    onToast('success', `Exported PDF to ${saved.path}`);
                  }}
                  className="h-9 rounded-xl bg-indigo-600 text-white font-semibold flex items-center justify-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" /> Save as PDF
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => pdfToImgInputRef.current?.click()}
            className="w-full h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2"
          >
            <ImageIcon className="w-4 h-4 text-amber-400" /> Convert PDF Pages to PNG Images
          </button>
        </div>
      )}
    </div>
  );
};
