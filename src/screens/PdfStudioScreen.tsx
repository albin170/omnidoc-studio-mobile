import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  FileText,
  Highlighter,
  Layers,
  Merge,
  Minimize2,
  PenTool,
  PlusSquare,
  RotateCw,
  Scissors,
  Search,
  Share2,
  Stamp,
  Trash2,
  Type,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { formatFileSize } from '../engines/formatDetector';
import {
  applyPdfAnnotations,
  compressPdf,
  countTextOccurrencesInPdf,
  deletePdfPage,
  duplicatePdfPage,
  extractTextFromPdf,
  imagesToPdf,
  insertBlankPage,
  loadPdfForViewing,
  mergePdfFiles,
  renderPdfPageToCanvas,
  reorderPdfPages,
  rotatePdfPage,
  splitPdfByRange,
  toSafeUint8Array,
} from '../engines/pdfService';
import {
  RedactionVerificationReport,
  searchAndRedactPdf,
} from '../engines/pdfRedactionService';
import { apiClient } from '../services/apiClient';
import { captureDocumentPhoto, hapticTap, saveFileToDevice, shareDocumentFile } from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';
import { PDFAnnotation } from '../types';

export interface PdfStudioScreenProps {
  initialFile?: File | null;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.25;
const ZOOM_STEP = 0.25;

type PlacementTool = 'none' | 'text' | 'highlight';

export const PdfStudioScreen: React.FC<PdfStudioScreenProps> = ({ initialFile, onToast }) => {
  const { isOnline } = useAuth();
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfJsDoc, setPdfJsDoc] = useState<any>(null);
  const [fileName, setFileName] = useState('document.pdf');
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomScale, setZoomScale] = useState(1.0);
  const [busy, setBusy] = useState(false);

  // Page size in PDF points (scale = 1) for accurate overlay & tap coordinates
  const [pagePointSize, setPagePointSize] = useState<{ width: number; height: number }>({
    width: 595,
    height: 842,
  });

  // Split & Extract Text
  const [splitStart, setSplitStart] = useState(1);
  const [splitEnd, setSplitEnd] = useState(1);
  const [extractedText, setExtractedText] = useState<string | null>(null);

  // In-PDF Search
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    totalMatches: number;
    pages: Array<{ pageNumber: number; matches: number }>;
  } | null>(null);

  // Delete confirmation dialog state
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Visual Annotations Sheet
  const [showAnnotationsSheet, setShowAnnotationsSheet] = useState(false);
  const [annotations, setAnnotations] = useState<PDFAnnotation[]>([]);
  const [placementTool, setPlacementTool] = useState<PlacementTool>('none');
  const [annotationText, setAnnotationText] = useState('');
  const [annotationColor, setAnnotationColor] = useState('#111827');
  const [highlightColor, setHighlightColor] = useState('#fef08a');
  const [watermarkText, setWatermarkText] = useState('');
  const [addPageNumbers, setAddPageNumbers] = useState(false);

  // Touch Signature Pad
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [hasSignatureStrokes, setHasSignatureStrokes] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingSigRef = useRef(false);

  // Genuine Content Redaction
  const [showRedactSheet, setShowRedactSheet] = useState(false);
  const [redactTermInput, setRedactTermInput] = useState('');
  const [redactTerms, setRedactTerms] = useState<string[]>([]);
  const [redactionReport, setRedactionReport] = useState<RedactionVerificationReport | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const pdfJsDocRef = useRef<any>(null);

  const destroyDoc = useCallback((doc: any) => {
    if (!doc) return;
    if (typeof doc.cleanup === 'function') {
      doc.cleanup().catch(() => {});
    }
    if (typeof doc.destroy === 'function') {
      doc.destroy().catch(() => {});
    }
  }, []);

  const loadBytes = useCallback(
    async (bytes: Uint8Array, name: string, targetPage?: number) => {
      const safe = toSafeUint8Array(bytes);
      const nextDoc = await loadPdfForViewing(safe);
      const prevDoc = pdfJsDocRef.current;
      pdfJsDocRef.current = nextDoc;
      if (prevDoc && prevDoc !== nextDoc) {
        destroyDoc(prevDoc);
      }

      const safePage = targetPage
        ? Math.min(Math.max(1, targetPage), nextDoc.numPages)
        : 1;

      setPdfBytes(safe);
      setPdfJsDoc(nextDoc);
      setFileName(name);
      setPageCount(nextDoc.numPages);
      setCurrentPage(safePage);
      setSplitStart(1);
      setSplitEnd(nextDoc.numPages);
      setExtractedText(null);
    },
    [destroyDoc]
  );

  // Cleanup PDF.js document on unmount
  useEffect(() => {
    return () => {
      if (pdfJsDocRef.current) {
        destroyDoc(pdfJsDocRef.current);
        pdfJsDocRef.current = null;
      }
    };
  }, [destroyDoc]);

  useEffect(() => {
    if (initialFile) {
      initialFile
        .arrayBuffer()
        .then((buf) => loadBytes(new Uint8Array(buf), initialFile.name))
        .catch((e) => {
          onToast('error', e?.message || 'Failed to open PDF');
        });
    }
  }, [initialFile, loadBytes, onToast]);

  // Render active page with cancelable RenderTask
  useEffect(() => {
    if (!pdfJsDoc || !canvasRef.current) return;
    let active = true;
    const canvas = canvasRef.current;

    const task = renderPdfPageToCanvas(pdfJsDoc, currentPage, canvas, zoomScale);
    task.promise
      .then(() => {
        if (!active || !canvas) return;
        if (canvas.width > 0 && canvas.height > 0) {
          setPagePointSize({
            width: canvas.width / zoomScale,
            height: canvas.height / zoomScale,
          });
        }
      })
      .catch((err: any) => {
        if (active && err?.name !== 'RenderingCancelledException') {
          onToast('error', err?.message || 'Could not render PDF page');
        }
      });

    return () => {
      active = false;
      task.cancel();
    };
  }, [pdfJsDoc, currentPage, zoomScale, onToast]);

  // Debounced In-PDF Search
  useEffect(() => {
    if (!pdfBytes || !searchQuery.trim()) {
      setSearchResult(null);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(() => {
      countTextOccurrencesInPdf(pdfBytes, searchQuery)
        .then((res) => {
          if (!cancelled) {
            setSearchResult(res);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSearchResult({ totalMatches: 0, pages: [] });
          }
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdfBytes, searchQuery]);

  const handleOpenFile = async (f: File) => {
    try {
      const buf = await f.arrayBuffer();
      setAnnotations([]);
      setWatermarkText('');
      setAddPageNumbers(false);
      setSearchQuery('');
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
        await loadBytes(merged, fileName, pageCount + 1);
        onToast('success', 'Appended scanned page to PDF.');
      } else {
        await loadBytes(newPdf, `scan_${Date.now()}.pdf`, 1);
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
      await loadBytes(next, fileName, currentPage);
      await hapticTap('light');
      onToast('success', `Rotated page ${currentPage} by 90°`);
    } catch (err: any) {
      onToast('error', err?.message || 'Rotate failed');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmedDeletePage = async () => {
    if (!pdfBytes) return;
    setConfirmDeleteOpen(false);
    setBusy(true);
    try {
      const deletedPageNum = currentPage;
      const next = await deletePdfPage(pdfBytes, deletedPageNum - 1);
      setAnnotations((prev) =>
        prev
          .filter((a) => a.pageIndex !== deletedPageNum - 1)
          .map((a) => (a.pageIndex > deletedPageNum - 1 ? { ...a, pageIndex: a.pageIndex - 1 } : a))
      );
      await loadBytes(next, fileName, Math.min(deletedPageNum, Math.max(1, pageCount - 1)));
      await hapticTap('medium');
      onToast('success', `Deleted page ${deletedPageNum} from PDF`);
    } catch (err: any) {
      onToast('error', err?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const handleMovePage = async (direction: 'left' | 'right') => {
    if (!pdfBytes || pageCount <= 1) return;
    const idx = currentPage - 1;
    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= pageCount) return;

    setBusy(true);
    try {
      const order = Array.from({ length: pageCount }, (_, i) => i);
      const tmp = order[idx];
      order[idx] = order[targetIdx];
      order[targetIdx] = tmp;

      const next = await reorderPdfPages(pdfBytes, order);
      await loadBytes(next, fileName, targetIdx + 1);
      await hapticTap('light');
      onToast('success', `Moved page to position ${targetIdx + 1}`);
    } catch (err: any) {
      onToast('error', err?.message || 'Page reorder failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicatePage = async () => {
    if (!pdfBytes) return;
    setBusy(true);
    try {
      const next = await duplicatePdfPage(pdfBytes, currentPage - 1);
      await loadBytes(next, fileName, currentPage + 1);
      await hapticTap('light');
      onToast('success', `Duplicated page ${currentPage}`);
    } catch (err: any) {
      onToast('error', err?.message || 'Duplicate page failed');
    } finally {
      setBusy(false);
    }
  };

  const handleInsertBlankPage = async () => {
    if (!pdfBytes) return;
    setBusy(true);
    try {
      const next = await insertBlankPage(pdfBytes, currentPage, pagePointSize.width, pagePointSize.height);
      await loadBytes(next, fileName, currentPage + 1);
      await hapticTap('light');
      onToast('success', `Inserted blank page after page ${currentPage}`);
    } catch (err: any) {
      onToast('error', err?.message || 'Insert blank page failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCompressPdf = async () => {
    if (!pdfBytes) return;
    setBusy(true);
    try {
      const beforeSize = pdfBytes.byteLength;
      const compressed = await compressPdf(pdfBytes);
      const afterSize = compressed.byteLength;
      await loadBytes(compressed, fileName, currentPage);
      await offlineStore.appendHistory({
        kind: 'pdf_operation',
        title: `Compressed ${fileName}`,
        sourceFormat: 'pdf',
        targetFormat: 'pdf',
        sizeBytes: afterSize,
        status: 'completed',
      });
      await hapticTap('light');
      if (afterSize < beforeSize) {
        const pct = Math.round(((beforeSize - afterSize) / beforeSize) * 100);
        onToast('success', `Optimized PDF: ${formatFileSize(beforeSize)} → ${formatFileSize(afterSize)} (${pct}% smaller)`);
      } else {
        onToast('info', `PDF object streams re-packed (${formatFileSize(afterSize)}).`);
      }
    } catch (err: any) {
      onToast('error', err?.message || 'PDF compression failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRunPermanentRedaction = async () => {
    if (!pdfBytes) return;
    const terms = Array.from(
      new Set(
        [...redactTerms, ...(redactTermInput.trim() ? [redactTermInput.trim()] : [])]
          .map((t) => t.trim())
          .filter(Boolean)
      )
    );
    if (terms.length === 0) {
      onToast('error', 'Enter a text term to search and permanently redact.');
      return;
    }

    setBusy(true);
    try {
      const result = await searchAndRedactPdf(pdfBytes, terms);
      await loadBytes(result.pdfBytes, fileName, currentPage);
      setRedactionReport(result.report);
      setRedactTerms([]);
      setRedactTermInput('');
      await offlineStore.appendHistory({
        kind: 'pdf_operation',
        title: `Redacted ${fileName} (${result.report.status})`,
        sourceFormat: 'pdf',
        targetFormat: 'pdf',
        sizeBytes: result.pdfBytes.byteLength,
        status: result.report.isSanitized ? 'completed' : 'failed',
      });
      await hapticTap('medium');
      if (result.report.isSanitized) {
        onToast('success', `Verified redaction (${result.report.redactionsApplied} target(s) scrubbed).`);
      } else {
        onToast('error', `Redaction status: ${result.report.status}. Review verification report.`);
      }
    } catch (err: any) {
      onToast('error', err?.message || 'PDF redaction failed');
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
      await loadBytes(merged, pdfBytes ? `merged_${fileName}` : 'merged_document.pdf', 1);
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
      setAnnotations([]);
      await loadBytes(splitBytes, `split_${splitStart}-${splitEnd}_${fileName}`, 1);
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

  // Place visual annotation on canvas tap or centered quick-add
  const addVisualAnnotationAt = (pdfX: number, pdfY: number, tool: Exclude<PlacementTool, 'none'>) => {
    if (tool === 'text') {
      const trimmed = annotationText.trim();
      if (!trimmed) {
        onToast('error', 'Enter annotation text before placing it on the page.');
        return;
      }
      setAnnotations((prev) => [
        ...prev,
        {
          id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          pageIndex: currentPage - 1,
          type: 'text',
          x: Math.max(12, Math.min(pdfX, pagePointSize.width - 80)),
          y: Math.max(24, Math.min(pdfY, pagePointSize.height - 16)),
          text: trimmed,
          fontSize: 14,
          color: annotationColor,
        },
      ]);
      setAnnotationText('');
      setPlacementTool('none');
      onToast('success', `Queued visual text overlay on page ${currentPage}`);
    } else if (tool === 'highlight') {
      setAnnotations((prev) => [
        ...prev,
        {
          id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          pageIndex: currentPage - 1,
          type: 'highlight',
          x: Math.max(12, Math.min(pdfX, pagePointSize.width - 150)),
          y: Math.max(12, Math.min(pdfY, pagePointSize.height - 28)),
          width: 150,
          height: 22,
          color: highlightColor,
          opacity: 0.45,
        },
      ]);
      setPlacementTool('none');
      onToast('success', `Queued highlight overlay on page ${currentPage}`);
    }
  };

  const handleCanvasTap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (placementTool === 'none' || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const pdfX = relX * pagePointSize.width;
    const pdfY = relY * pagePointSize.height;
    addVisualAnnotationAt(pdfX, pdfY, placementTool);
  };

  // Touch / Pointer Signature Pad handlers
  const getSigPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleSigPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setPointerCapture?.(e.pointerId);
    isDrawingSigRef.current = true;
    const { x, y } = getSigPoint(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleSigPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingSigRef.current) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getSigPoint(e);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignatureStrokes(true);
  };

  const handleSigPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDrawingSigRef.current = false;
    signatureCanvasRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const clearSignaturePad = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignatureStrokes(false);
  };

  const handleQueueSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas || !hasSignatureStrokes) {
      onToast('error', 'Draw a signature on the pad first.');
      return;
    }
    const dataUrl = canvas.toDataURL('image/png');
    setAnnotations((prev) => [
      ...prev,
      {
        id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pageIndex: currentPage - 1,
        type: 'signature',
        x: Math.max(24, pagePointSize.width - 190),
        y: Math.max(40, pagePointSize.height - 110),
        width: 150,
        height: 60,
        dataUrl,
      },
    ]);
    clearSignaturePad();
    setShowSignaturePad(false);
    onToast('success', `Signature overlay queued for page ${currentPage}`);
  };

  const handleApplyVisualAnnotations = async () => {
    if (!pdfBytes) return;
    const hasChanges = annotations.length > 0 || watermarkText.trim().length > 0 || addPageNumbers;
    if (!hasChanges) {
      onToast('info', 'Add a text note, highlight, signature, watermark, or page numbers first.');
      return;
    }

    setBusy(true);
    try {
      const updated = await applyPdfAnnotations(pdfBytes, annotations, {
        watermarkText: watermarkText.trim() || undefined,
        addPageNumbers,
      });
      await loadBytes(updated, fileName, currentPage);
      await offlineStore.appendHistory({
        kind: 'pdf_operation',
        title: `Applied visual overlays to ${fileName}`,
        sourceFormat: 'pdf',
        targetFormat: 'pdf',
        sizeBytes: updated.byteLength,
        status: 'completed',
      });
      setAnnotations([]);
      setWatermarkText('');
      setAddPageNumbers(false);
      setPlacementTool('none');
      await hapticTap('medium');
      onToast('success', 'Applied visual annotations and overlays to PDF.');
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to apply visual annotations');
    } finally {
      setBusy(false);
    }
  };

  const exportBlob = () => (pdfBytes ? new Blob([pdfBytes as any], { type: 'application/pdf' }) : null);
  const currentPageAnnotations = annotations.filter((a) => a.pageIndex === currentPage - 1);
  const pendingOverlayCount =
    annotations.length + (watermarkText.trim() ? 1 : 0) + (addPageNumbers ? 1 : 0);

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

      {/* Open / Scan / Merge Bar */}
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
          className="h-11 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          <Camera className="w-4 h-4" /> Scan Page
        </button>
        <button
          onClick={() => mergeInputRef.current?.click()}
          disabled={busy}
          className="h-11 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40"
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
          {/* In-PDF Search Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search text inside PDF..."
                  aria-label="Search text inside PDF"
                  className="w-full h-9 pl-8 pr-8 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {searchQuery.trim() && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] font-semibold text-cyan-300 shrink-0">
                  {isSearching ? 'Searching...' : `${searchResult?.totalMatches ?? 0} matches`}
                </span>
              )}
            </div>

            {searchResult && searchResult.pages.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Jump to:</span>
                {searchResult.pages.map((p) => (
                  <button
                    key={p.pageNumber}
                    onClick={() => setCurrentPage(p.pageNumber)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors ${
                      currentPage === p.pageNumber
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-700 text-slate-300'
                    }`}
                  >
                    Pg {p.pageNumber} ({p.matches})
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* File Summary, Zoom & Viewer */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="font-semibold truncate max-w-[175px]">{fileName}</span>
              <span className="text-slate-400 shrink-0">
                {pageCount} {pageCount === 1 ? 'page' : 'pages'} · {formatFileSize(pdfBytes.byteLength)}
              </span>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5">
              <span className="text-[11px] text-slate-400 font-medium">Zoom</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setZoomScale((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))}
                  disabled={zoomScale <= MIN_ZOOM}
                  aria-label="Zoom out"
                  className="h-8 w-8 rounded-lg bg-slate-800 flex items-center justify-center disabled:opacity-40"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setZoomScale(1.0)}
                  className="h-8 px-2.5 rounded-lg bg-slate-800 text-[11px] font-mono font-semibold text-slate-200"
                  title="Reset zoom to 100%"
                >
                  {Math.round(zoomScale * 100)}%
                </button>
                <button
                  onClick={() => setZoomScale((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))}
                  disabled={zoomScale >= MAX_ZOOM}
                  aria-label="Zoom in"
                  className="h-8 w-8 rounded-lg bg-slate-800 flex items-center justify-center disabled:opacity-40"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {placementTool !== 'none' && (
              <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-indigo-500/15 border border-indigo-500/40 text-xs text-indigo-200">
                <span>
                  Tap anywhere on the page to place{' '}
                  <strong>{placementTool === 'text' ? 'Visual Text Overlay' : 'Highlight Box'}</strong>
                </span>
                <button
                  onClick={() => setPlacementTool('none')}
                  className="text-slate-300 hover:text-white font-semibold ml-2"
                >
                  Cancel
                </button>
              </div>
            )}

            <div className="bg-slate-950 rounded-xl p-2 overflow-auto max-h-[400px] border border-slate-800 flex justify-center">
              <div className="relative inline-block">
                <canvas
                  ref={canvasRef}
                  onClick={handleCanvasTap}
                  className={`block rounded ${
                    zoomScale <= 1.0 ? 'max-w-full h-auto' : ''
                  } ${placementTool !== 'none' ? 'cursor-crosshair ring-2 ring-indigo-500/70' : ''}`}
                />
                {/* Live Visual Overlay Previews */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden rounded">
                  {currentPageAnnotations.map((ann) => {
                    const leftPct = (ann.x / pagePointSize.width) * 100;
                    const topPct = (ann.y / pagePointSize.height) * 100;
                    if (ann.type === 'text') {
                      return (
                        <span
                          key={ann.id}
                          style={{
                            left: `${leftPct}%`,
                            top: `${topPct}%`,
                            color: ann.color || '#111827',
                          }}
                          className="absolute text-[11px] font-semibold bg-white/75 px-1 rounded shadow-sm -translate-y-1/2"
                        >
                          {ann.text}
                        </span>
                      );
                    }
                    if (ann.type === 'highlight') {
                      const wPct = ((ann.width || 150) / pagePointSize.width) * 100;
                      const hPct = ((ann.height || 22) / pagePointSize.height) * 100;
                      return (
                        <div
                          key={ann.id}
                          style={{
                            left: `${leftPct}%`,
                            top: `${topPct}%`,
                            width: `${wPct}%`,
                            height: `${hPct}%`,
                            backgroundColor: ann.color || '#fef08a',
                            opacity: 0.55,
                          }}
                          className="absolute rounded-sm border border-amber-400/60"
                        />
                      );
                    }
                    if (ann.type === 'signature' && ann.dataUrl) {
                      const wPct = ((ann.width || 150) / pagePointSize.width) * 100;
                      const hPct = ((ann.height || 60) / pagePointSize.height) * 100;
                      return (
                        <img
                          key={ann.id}
                          src={ann.dataUrl}
                          alt="Pending signature overlay"
                          style={{
                            left: `${leftPct}%`,
                            top: `${topPct}%`,
                            width: `${wPct}%`,
                            height: `${hPct}%`,
                          }}
                          className="absolute object-contain border border-dashed border-indigo-400/60 bg-white/40 rounded"
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            </div>

            {/* Page Navigation */}
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

          {/* Page Operations Grid */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleRotate}
              disabled={busy}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <RotateCw className="w-4 h-4 text-cyan-400" /> Rotate 90°
            </button>
            <button
              onClick={handleDuplicatePage}
              disabled={busy}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Copy className="w-4 h-4 text-indigo-400" /> Duplicate
            </button>
            <button
              onClick={handleInsertBlankPage}
              disabled={busy}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <PlusSquare className="w-4 h-4 text-emerald-400" /> Blank Pg
            </button>
            <button
              onClick={() => handleMovePage('left')}
              disabled={busy || currentPage <= 1}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <ArrowLeft className="w-4 h-4 text-sky-400" /> Move Left
            </button>
            <button
              onClick={() => handleMovePage('right')}
              disabled={busy || currentPage >= pageCount}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <ArrowRight className="w-4 h-4 text-sky-400" /> Move Right
            </button>
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={busy || pageCount <= 1}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4 text-rose-400" /> Delete Pg
            </button>
          </div>

          {/* Compress & Extract Text */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCompressPdf}
              disabled={busy}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Minimize2 className="w-4 h-4 text-amber-400" /> Compress / Optimize
            </button>
            <button
              onClick={handleExtractText}
              disabled={busy}
              className="h-11 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <FileText className="w-4 h-4 text-emerald-400" /> Extract Text
            </button>
          </div>

          {/* Genuine Content Redaction Sheet */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowRedactSheet((s) => !s)}
              className="w-full p-3.5 flex items-center justify-between text-left"
            >
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                <Scissors className="w-4 h-4 text-rose-400" />
                Permanent Content Redaction
                {redactTerms.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                    {redactTerms.length} queued
                  </span>
                )}
              </span>
              <span className="text-[11px] text-rose-300 font-semibold">
                {showRedactSheet ? 'Hide' : 'Open'}
              </span>
            </button>

            {showRedactSheet && (
              <div className="px-3.5 pb-4 pt-2 space-y-3 border-t border-slate-800">
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Scrubs matching text and metadata from PDF content streams, removes page annotations, draws opaque
                  blackouts, and verifies zero residual matches via PDF.js extraction &amp; binary inspection.
                </p>

                <div className="flex gap-2">
                  <input
                    id="pdf-redact-term"
                    name="redactTerm"
                    type="text"
                    value={redactTermInput}
                    onChange={(e) => setRedactTermInput(e.target.value)}
                    placeholder="Enter sensitive text (e.g. SSN or secret)..."
                    className="flex-1 h-9 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = redactTermInput.trim();
                      if (!clean) return;
                      setRedactTerms((prev) => Array.from(new Set([...prev, clean])));
                      setRedactTermInput('');
                    }}
                    className="h-9 px-3 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200"
                  >
                    Add
                  </button>
                </div>

                {redactTerms.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {redactTerms.map((term) => (
                      <span
                        key={term}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-[11px] text-rose-200"
                      >
                        {term}
                        <button
                          type="button"
                          onClick={() => setRedactTerms((prev) => prev.filter((t) => t !== term))}
                          aria-label={`Remove redact term ${term}`}
                          className="text-rose-300 hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  disabled={busy || (!redactTermInput.trim() && redactTerms.length === 0)}
                  onClick={handleRunPermanentRedaction}
                  className="w-full h-10 rounded-xl bg-rose-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <Check className="w-4 h-4" /> Search &amp; Permanently Redact
                </button>

                {redactionReport && (
                  <div
                    className={`rounded-xl p-3 border text-[11px] space-y-1 ${
                      redactionReport.isSanitized
                        ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                        : 'bg-amber-950/60 border-amber-500/40 text-amber-200'
                    }`}
                  >
                    <p className="font-semibold">
                      Verification Status: {redactionReport.status} ({redactionReport.redactionsApplied} applied)
                    </p>
                    <p>
                      Metadata cleared: {redactionReport.metadataCleared ? 'Yes' : 'No'} · Residual matches:{' '}
                      {redactionReport.residualMatches.length}
                    </p>
                    {redactionReport.imagesDetectedOnRedactedPages && (
                      <p className="text-amber-300">
                        Raster images detected on redacted pages; scanned pixels require image-level masking or OCR
                        re-creation.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Visual Annotations & Overlays Sheet */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowAnnotationsSheet((s) => !s)}
              className="w-full p-3.5 flex items-center justify-between text-left"
            >
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                Visual Annotations &amp; Overlays
                {pendingOverlayCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">
                    {pendingOverlayCount} queued
                  </span>
                )}
              </span>
              <span className="text-[11px] text-indigo-400 font-semibold">
                {showAnnotationsSheet ? 'Hide' : 'Open'}
              </span>
            </button>

            {showAnnotationsSheet && (
              <div className="px-3.5 pb-4 pt-1 space-y-3.5 border-t border-slate-800">
                {/* Explicit Architectural Honesty Disclosure */}
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-2.5 flex items-start gap-2 text-[11px] text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Visual Overlays Only:</strong> Text notes, highlights, signatures, and watermarks are
                    drawn as visual overlays and do <em>not</em> scrub or remove underlying PDF text streams.
                  </span>
                </div>

                {/* Add Text Overlay */}
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                    <Type className="w-3.5 h-3.5 text-indigo-400" /> Add Visual Text Note
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={annotationText}
                      onChange={(e) => setAnnotationText(e.target.value)}
                      placeholder="Enter visual note text..."
                      className="flex-1 h-9 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs"
                    />
                    <div className="flex items-center gap-1">
                      {['#111827', '#2563eb', '#dc2626', '#059669'].map((c) => (
                        <button
                          key={c}
                          onClick={() => setAnnotationColor(c)}
                          aria-label={`Text color ${c}`}
                          style={{ backgroundColor: c }}
                          className={`w-6 h-6 rounded-full border ${
                            annotationColor === c ? 'border-white scale-110' : 'border-slate-700'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        if (!annotationText.trim()) {
                          onToast('error', 'Enter text first.');
                          return;
                        }
                        setPlacementTool('text');
                      }}
                      className="h-9 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200"
                    >
                      Tap Page to Place
                    </button>
                    <button
                      onClick={() => addVisualAnnotationAt(72, 120, 'text')}
                      className="h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/40 text-xs font-semibold text-indigo-200"
                    >
                      Quick Add (Pg {currentPage})
                    </button>
                  </div>
                </div>

                {/* Highlight Box */}
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                      <Highlighter className="w-3.5 h-3.5 text-amber-300" /> Highlight Box Overlay
                    </label>
                    <div className="flex items-center gap-1.5">
                      {['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8'].map((c) => (
                        <button
                          key={c}
                          onClick={() => setHighlightColor(c)}
                          aria-label={`Highlight color ${c}`}
                          style={{ backgroundColor: c }}
                          className={`w-5 h-5 rounded border ${
                            highlightColor === c ? 'border-white scale-110' : 'border-slate-700'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setPlacementTool('highlight')}
                      className="h-9 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200"
                    >
                      Tap Page to Highlight
                    </button>
                    <button
                      onClick={() => addVisualAnnotationAt(72, 180, 'highlight')}
                      className="h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 text-xs font-semibold text-amber-200"
                    >
                      Add Highlight Box
                    </button>
                  </div>
                </div>

                {/* Touch Signature Pad */}
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                      <PenTool className="w-3.5 h-3.5 text-cyan-400" /> Touch Signature Pad
                    </span>
                    <button
                      onClick={() => setShowSignaturePad((s) => !s)}
                      className="text-[11px] font-semibold text-cyan-400"
                    >
                      {showSignaturePad ? 'Close Pad' : 'Draw Signature'}
                    </button>
                  </div>

                  {showSignaturePad && (
                    <div className="space-y-2 bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                      <p className="text-[10px] text-slate-400">
                        Sign with your finger or stylus below (creates a PNG visual stamp):
                      </p>
                      <div className="rounded-lg bg-white overflow-hidden border border-slate-700">
                        <canvas
                          ref={signatureCanvasRef}
                          width={340}
                          height={140}
                          onPointerDown={handleSigPointerDown}
                          onPointerMove={handleSigPointerMove}
                          onPointerUp={handleSigPointerUp}
                          onPointerCancel={handleSigPointerUp}
                          className="w-full h-32 touch-none block cursor-crosshair"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={clearSignaturePad}
                          className="h-9 px-3 rounded-lg bg-slate-800 text-xs text-slate-300"
                        >
                          Clear
                        </button>
                        <button
                          onClick={handleQueueSignature}
                          className="flex-1 h-9 rounded-lg bg-cyan-600 text-xs font-semibold text-white"
                        >
                          Queue Signature on Pg {currentPage}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Watermark & Page Numbers */}
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                    <Stamp className="w-3.5 h-3.5 text-indigo-400" /> Watermark &amp; Page Numbers
                  </label>
                  <input
                    type="text"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                    placeholder="Watermark text (e.g. CONFIDENTIAL)"
                    className="w-full h-9 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs"
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={addPageNumbers}
                      onChange={(e) => setAddPageNumbers(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950 text-indigo-500"
                    />
                    <span>Add page numbers (Page X of {pageCount})</span>
                  </label>
                </div>

                {/* Queued Annotations List */}
                {annotations.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Queued Visual Overlays ({annotations.length})</span>
                      <button
                        onClick={() => setAnnotations([])}
                        className="text-rose-400 font-semibold"
                      >
                        Clear All
                      </button>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {annotations.map((ann) => (
                        <div
                          key={ann.id}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px]"
                        >
                          <span className="truncate text-slate-300">
                            Pg {ann.pageIndex + 1} · <strong className="uppercase">{ann.type}</strong>
                            {ann.text ? `: ${ann.text}` : ''}
                          </span>
                          <button
                            onClick={() =>
                              setAnnotations((prev) => prev.filter((item) => item.id !== ann.id))
                            }
                            aria-label="Remove overlay"
                            className="text-slate-400 hover:text-rose-400 ml-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleApplyVisualAnnotations}
                  disabled={busy || pendingOverlayCount === 0}
                  className="w-full h-10 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <Check className="w-4 h-4" /> Apply Visual Overlays to PDF
                </button>
              </div>
            )}
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
                className="flex-1 h-10 rounded-xl bg-amber-600 text-xs font-semibold text-white disabled:opacity-40"
              >
                Split PDF
              </button>
            </div>
          </div>

          {extractedText !== null && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-emerald-300">Extracted Text</h4>
                <button
                  onClick={() => setExtractedText(null)}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  Dismiss
                </button>
              </div>
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

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete Page ${currentPage}?`}
        message={`This will remove page ${currentPage} of ${pageCount} from "${fileName}" in your working document.`}
        confirmLabel="Delete Page"
        cancelLabel="Cancel"
        danger
        busy={busy}
        onConfirm={handleConfirmedDeletePage}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
};
