import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  Merge,
  RotateCw,
  Scissors,
  Share2,
  Stamp,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatFileSize } from '../engines/formatDetector';
import {
  applyPdfAnnotations,
  deletePdfPage,
  extractTextFromPdf,
  imagesToPdf,
  loadPdfForViewing,
  mergePdfFiles,
  renderPdfPageToCanvas,
  rotatePdfPage,
  splitPdfByRange,
  toSafeUint8Array,
} from '../engines/pdfService';
import { apiClient } from '../services/apiClient';
import { captureDocumentPhoto, hapticTap, saveFileToDevice, shareDocumentFile } from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';

interface PdfStudioScreenProps {
  initialFile?: File | null;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}

export const PdfStudioScreen: React.FC<PdfStudioScreenProps> = ({ initialFile, onToast }) => {
  const { isOnline } = useAuth();
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('document.pdf');
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const [splitStart, setSplitStart] = useState(1);
  const [splitEnd, setSplitEnd] = useState(1);
  const [watermarkText, setWatermarkText] = useState('');
  const [extractedText, setExtractedText] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  const loadBytes = async (bytes: Uint8Array, name: string) => {
    const safe = toSafeUint8Array(bytes);
    const doc = await loadPdfForViewing(safe);
    setPdfBytes(safe);
    setFileName(name);
    setPageCount(doc.numPages);
    setCurrentPage(1);
    setSplitStart(1);
    setSplitEnd(doc.numPages);
    setExtractedText(null);
  };

  useEffect(() => {
    if (initialFile) {
      initialFile.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), initialFile.name)).catch((e) => {
        onToast('error', e?.message || 'Failed to open PDF');
      });
    }
  }, [initialFile, onToast]);

  useEffect(() => {
    if (!pdfBytes || !canvasRef.current) return;
    let active = true;
    (async () => {
      try {
        const doc = await loadPdfForViewing(pdfBytes);
        if (!active || !canvasRef.current) return;
        await renderPdfPageToCanvas(doc, currentPage, canvasRef.current, 1.35);
      } catch (err: any) {
        if (active) onToast('error', err?.message || 'Could not render PDF page');
      }
    })();
    return () => {
      active = false;
    };
  }, [pdfBytes, currentPage, onToast]);

  const handleOpenFile = async (f: File) => {
    try {
      const buf = await f.arrayBuffer();
      await loadBytes(new Uint8Array(buf), f.name);
      onToast('success', `Loaded "${f.name}"`);
    } catch (err: any) {
      onToast('error', err?.message || 'Invalid PDF file');
    }
  };

  const handleCameraScanToPdf = async () => {
    setBusy(true);
    try {
      const photo = await captureDocumentPhoto('prompt');
      const newPdf = await imagesToPdf([{ bytes: photo.bytes, mimeType: photo.mimeType }]);
      if (pdfBytes) {
        const merged = await mergePdfFiles([pdfBytes.buffer as ArrayBuffer, newPdf.buffer as ArrayBuffer]);
        await loadBytes(merged, fileName);
        onToast('success', 'Appended scanned page to PDF.');
      } else {
        await loadBytes(newPdf, `scan_${Date.now()}.pdf`);
        onToast('success', 'Created PDF from camera scan.');
      }
      await offlineStore.appendHistory({
        kind: 'camera_scan',
        title: 'Scanned document to PDF',
        sourceFormat: 'jpg',
        targetFormat: 'pdf',
        sizeBytes: newPdf.byteLength,
        status: 'completed',
      });
    } catch (err: any) {
      if (!String(err?.message || '').toLowerCase().includes('cancel')) {
        onToast('error', err?.message || 'Scan failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRotate = async () => {
    if (!pdfBytes) return;
    setBusy(true);
    try {
      const next = await rotatePdfPage(pdfBytes, currentPage - 1, 90);
      await loadBytes(next, fileName);
      await hapticTap('light');
      onToast('success', `Rotated page ${currentPage} by 90°`);
    } catch (err: any) {
      onToast('error', err?.message || 'Rotate failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePage = async () => {
    if (!pdfBytes) return;
    setBusy(true);
    try {
      const next = await deletePdfPage(pdfBytes, currentPage - 1);
      await loadBytes(next, fileName);
      await hapticTap('medium');
      onToast('success', 'Deleted page from PDF');
    } catch (err: any) {
      onToast('error', err?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const handleMerge = async (files: FileList) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const buffers: ArrayBuffer[] = [];
      if (pdfBytes) buffers.push(toSafeUint8Array(pdfBytes).buffer as ArrayBuffer);
      for (const f of Array.from(files)) {
        buffers.push(await f.arrayBuffer());
      }
      const merged = await mergePdfFiles(buffers);
      await loadBytes(merged, pdfBytes ? `merged_${fileName}` : 'merged_document.pdf');
      await offlineStore.appendHistory({
        kind: 'pdf_operation',
        title: `Merged ${buffers.length} PDFs`,
        sourceFormat: 'pdf',
        targetFormat: 'pdf',
        sizeBytes: merged.byteLength,
        status: 'completed',
      });
      onToast('success', `Merged ${buffers.length} PDFs successfully.`);
    } catch (err: any) {
      onToast('error', err?.message || 'Merge failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSplit = async () => {
    if (!pdfBytes) return;
    setBusy(true);
    try {
      const splitBytes = await splitPdfByRange(pdfBytes, splitStart, splitEnd);
      await loadBytes(splitBytes, `split_${splitStart}-${splitEnd}_${fileName}`);
      await offlineStore.appendHistory({
        kind: 'pdf_operation',
        title: `Split PDF pages ${splitStart}-${splitEnd}`,
        sourceFormat: 'pdf',
        targetFormat: 'pdf',
        sizeBytes: splitBytes.byteLength,
        status: 'completed',
      });
      onToast('success', `Extracted pages ${splitStart} to ${splitEnd}`);
    } catch (err: any) {
      onToast('error', err?.message || 'Split failed');
    } finally {
      setBusy(false);
    }
  };

  const handleWatermark = async () => {
    if (!pdfBytes || !watermarkText.trim()) return;
    setBusy(true);
    try {
      const updated = await applyPdfAnnotations(pdfBytes, [], {
        watermarkText: watermarkText.trim(),
        addPageNumbers: true,
      });
      await loadBytes(updated, fileName);
      setWatermarkText('');
      onToast('success', 'Applied watermark and page numbers.');
    } catch (err: any) {
      onToast('error', err?.message || 'Watermark failed');
    } finally {
      setBusy(false);
    }
  };

  const handleExtractText = async () => {
    if (!pdfBytes) return;
    setBusy(true);
    try {
      const txt = await extractTextFromPdf(pdfBytes);
      setExtractedText(txt || '(No selectable text found on pages)');
    } catch (err: any) {
      onToast('error', err?.message || 'Text extraction failed');
    } finally {
      setBusy(false);
    }
  };

  const exportBlob = () => (pdfBytes ? new Blob([pdfBytes as any], { type: 'application/pdf' }) : null);

  return (
    <div className="space-y-4 pb-6">
      <input
        ref={openInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleOpenFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={mergeInputRef}
        type="file"
        multiple
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleMerge(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Open / Scan Bar */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => openInputRef.current?.click()}
          className="h-11 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <FilePlus2 className="w-4 h-4 text-indigo-400" /> Open PDF
        </button>
        <button
          onClick={handleCameraScanToPdf}
          disabled={busy}
          className="h-11 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
        >
          <Camera className="w-4 h-4" /> Scan Page
        </button>
        <button
          onClick={() => mergeInputRef.current?.click()}
          disabled={busy}
          className="h-11 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <Merge className="w-4 h-4 text-cyan-400" /> Merge
        </button>
      </div>

      {!pdfBytes ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
          <FileText className="w-10 h-10 mx-auto text-rose-400" />
          <p className="text-sm font-semibold">PDF Studio Ready</p>
          <p className="text-xs text-slate-400">
            Open a PDF from your device, select one from the Vault Library, or capture pages with your camera.
          </p>
        </div>
      ) : (
        <>
          {/* File Summary & Viewer */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold truncate max-w-[200px]">{fileName}</span>
              <span className="text-slate-400">
                {pageCount} pages · {formatFileSize(pdfBytes.byteLength)}
              </span>
            </div>

            <div className="bg-slate-950 rounded-xl p-2 flex justify-center overflow-auto max-h-[360px] border border-slate-800">
              <canvas ref={canvasRef} className="max-w-full h-auto rounded" />
            </div>

            <div className="flex items-center justify-between">
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="h-9 px-3 rounded-lg bg-slate-800 text-xs disabled:opacity-40 flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <span className="text-xs font-medium text-slate-300">
                Page {currentPage} of {pageCount}
              </span>
              <button
                disabled={currentPage >= pageCount}
                onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                className="h-9 px-3 rounded-lg bg-slate-800 text-xs disabled:opacity-40 flex items-center gap-1"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Page Operations */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleRotate}
              disabled={busy}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5"
            >
              <RotateCw className="w-4 h-4 text-cyan-400" /> Rotate 90°
            </button>
            <button
              onClick={handleDeletePage}
              disabled={busy || pageCount <= 1}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4 text-rose-400" /> Delete Pg
            </button>
            <button
              onClick={handleExtractText}
              disabled={busy}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5"
            >
              <FileText className="w-4 h-4 text-emerald-400" /> Extract Txt
            </button>
          </div>

          {/* Split Range */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5 text-amber-400" /> Split Page Range
            </h4>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={pageCount}
                value={splitStart}
                onChange={(e) => setSplitStart(Number(e.target.value))}
                className="w-20 h-10 px-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="number"
                min={1}
                max={pageCount}
                value={splitEnd}
                onChange={(e) => setSplitEnd(Number(e.target.value))}
                className="w-20 h-10 px-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs"
              />
              <button
                onClick={handleSplit}
                disabled={busy}
                className="flex-1 h-10 rounded-xl bg-amber-600 text-xs font-semibold text-white"
              >
                Split PDF
              </button>
            </div>
          </div>

          {/* Watermark + Page Numbers */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Stamp className="w-3.5 h-3.5 text-indigo-400" /> Watermark &amp; Page Numbers
            </h4>
            <div className="flex gap-2">
              <input
                type="text"
                value={watermarkText}
                onChange={(e) => setWatermarkText(e.target.value)}
                placeholder="CONFIDENTIAL"
                className="flex-1 h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs"
              />
              <button
                onClick={handleWatermark}
                disabled={busy || !watermarkText.trim()}
                className="px-4 h-10 rounded-xl bg-indigo-600 text-xs font-semibold text-white disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          </div>

          {extractedText !== null && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
              <h4 className="text-xs font-semibold text-emerald-300">Extracted Text</h4>
              <pre className="text-[11px] text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
                {extractedText}
              </pre>
            </div>
          )}

          {/* Save / Share / Upload */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={async () => {
                const blob = exportBlob();
                if (!blob) return;
                const saved = await saveFileToDevice(blob, fileName);
                onToast('success', `Saved to ${saved.path}`);
              }}
              className="h-11 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <Download className="w-4 h-4 text-cyan-400" /> Save
            </button>
            <button
              onClick={async () => {
                const blob = exportBlob();
                if (!blob) return;
                await shareDocumentFile(blob, fileName, fileName);
              }}
              className="h-11 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <Share2 className="w-4 h-4 text-indigo-400" /> Share
            </button>
            <button
              disabled={!isOnline || busy}
              onClick={async () => {
                const blob = exportBlob();
                if (!blob) return;
                setBusy(true);
                try {
                  const uploaded = await apiClient.uploadDocument(
                    new File([blob], fileName, { type: 'application/pdf' })
                  );
                  onToast('success', `Uploaded "${uploaded.filename}" to vault.`);
                } catch (err: any) {
                  onToast('error', err?.message || 'Upload failed');
                } finally {
                  setBusy(false);
                }
              }}
              className="h-11 rounded-xl bg-emerald-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Upload className="w-4 h-4" /> Upload
            </button>
          </div>
        </>
      )}
    </div>
  );
};
