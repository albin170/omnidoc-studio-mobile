import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFAnnotation } from '../types';

// Configure PDF.js legacy worker using local Vite-bundled module so PDF rendering works 100% offline inside Android WebView (< Chrome 140).
// In Node.js/Vitest environments, leave PDF.js's built-in relative Node worker fallback ("./pdf.worker.mjs") intact.
try {
  const isNodeRuntime = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!isNodeRuntime) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }
} catch (e) {
  console.warn('PDF.js local worker initialization warning:', e);
}

export interface CancelableRenderTask {
  promise: Promise<void>;
  cancel: () => void;
}

export function toSafeUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (!input) return new Uint8Array(0);
  if (input instanceof Uint8Array) {
    if (input.buffer.byteLength === 0) {
      throw new Error('PDF data buffer has been detached or cleared.');
    }
    return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  }
  if (input.byteLength === 0) {
    throw new Error('PDF ArrayBuffer has been detached or is empty.');
  }
  return new Uint8Array(input.slice(0));
}

export async function loadPdfForViewing(data: ArrayBuffer | Uint8Array) {
  const dataCopy = toSafeUint8Array(data);
  const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
  return await loadingTask.promise;
}

/**
 * Render a PDF page onto an HTMLCanvasElement with cooperative cancellation support
 * so rapid page or zoom changes never throw or leak canvas state.
 */
export function renderPdfPageToCanvas(
  pdfJsDoc: any,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.0
): CancelableRenderTask {
  let cancelled = false;
  let activeRenderTask: any = null;

  const cancel = () => {
    cancelled = true;
    try {
      activeRenderTask?.cancel?.();
    } catch {
      // ignore cancellation errors from PDF.js RenderTask
    }
  };

  const promise = (async () => {
    const page = await pdfJsDoc.getPage(pageNumber);
    if (cancelled) return;

    const viewport = page.getViewport({ scale });
    if (cancelled) return;

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    activeRenderTask = page.render({ canvasContext: ctx, viewport, canvas });
    try {
      await activeRenderTask.promise;
    } catch (err: any) {
      if (cancelled || err?.name === 'RenderingCancelledException') {
        return;
      }
      throw err;
    }
  })();

  return { promise, cancel };
}

export async function extractTextFromPdf(pdfBytes: ArrayBuffer | Uint8Array): Promise<string> {
  const pdfJsDoc = await loadPdfForViewing(pdfBytes);
  try {
    const numPages = pdfJsDoc.numPages;
    let fullText = '';

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfJsDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str || '').join(' ');
      fullText += `--- Page ${i} ---\n${pageText}\n\n`;
    }

    return fullText.trim();
  } finally {
    try {
      await pdfJsDoc?.cleanup?.();
      await (pdfJsDoc as any)?.destroy?.();
    } catch {
      // ignore cleanup failure
    }
  }
}

export async function renderPdfPagesToImages(
  pdfBytes: ArrayBuffer | Uint8Array,
  format: 'png' | 'jpeg' = 'png'
): Promise<Blob[]> {
  const pdfJsDoc = await loadPdfForViewing(pdfBytes);
  try {
    const numPages = pdfJsDoc.numPages;
    const imageBlobs: Blob[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfJsDoc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b || new Blob([])), `image/${format}`, 0.92);
      });
      imageBlobs.push(blob);
    }

    return imageBlobs;
  } finally {
    try {
      await pdfJsDoc?.cleanup?.();
      await (pdfJsDoc as any)?.destroy?.();
    } catch {
      // ignore cleanup failure
    }
  }
}

export async function mergePdfFiles(pdfBuffers: ArrayBuffer[]): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();
  for (const buffer of pdfBuffers) {
    const donorPdf = await PDFDocument.load(toSafeUint8Array(buffer), { ignoreEncryption: true });
    const copiedPages = await mergedPdf.copyPages(donorPdf, donorPdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }
  return await mergedPdf.save();
}

export async function splitPdfByRange(
  pdfBuffer: ArrayBuffer | Uint8Array,
  startPage: number,
  endPage: number
): Promise<Uint8Array> {
  const srcPdf = await PDFDocument.load(toSafeUint8Array(pdfBuffer), { ignoreEncryption: true });
  const totalPages = srcPdf.getPageCount();
  const validStart = Math.max(1, startPage);
  const validEnd = Math.min(totalPages, endPage);
  if (validStart > validEnd) {
    throw new Error(`Invalid page range ${startPage}-${endPage} for ${totalPages}-page PDF.`);
  }
  const subPdf = await PDFDocument.create();
  const pageIndices: number[] = [];
  for (let i = validStart - 1; i <= validEnd - 1; i++) {
    pageIndices.push(i);
  }
  const copiedPages = await subPdf.copyPages(srcPdf, pageIndices);
  copiedPages.forEach((page) => subPdf.addPage(page));
  return await subPdf.save();
}

export async function deletePdfPage(
  pdfBuffer: ArrayBuffer | Uint8Array,
  pageIndex: number
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(toSafeUint8Array(pdfBuffer), { ignoreEncryption: true });
  if (pdfDoc.getPageCount() <= 1) {
    throw new Error('Cannot delete the only page of a PDF document.');
  }
  if (pageIndex >= 0 && pageIndex < pdfDoc.getPageCount()) {
    pdfDoc.removePage(pageIndex);
  }
  return await pdfDoc.save();
}

export async function duplicatePdfPage(
  pdfBuffer: ArrayBuffer | Uint8Array,
  pageIndex: number
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(toSafeUint8Array(pdfBuffer), { ignoreEncryption: true });
  if (pageIndex >= 0 && pageIndex < pdfDoc.getPageCount()) {
    const [copied] = await pdfDoc.copyPages(pdfDoc, [pageIndex]);
    pdfDoc.insertPage(pageIndex + 1, copied);
  }
  return await pdfDoc.save();
}

export async function insertBlankPage(
  pdfBuffer: ArrayBuffer | Uint8Array,
  atIndex?: number,
  width = 612,
  height = 792
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(toSafeUint8Array(pdfBuffer), { ignoreEncryption: true });
  const idx =
    atIndex !== undefined && atIndex >= 0
      ? Math.min(atIndex, pdfDoc.getPageCount())
      : pdfDoc.getPageCount();
  pdfDoc.insertPage(idx, [width, height]);
  return await pdfDoc.save();
}

export async function rotatePdfPage(
  pdfBuffer: ArrayBuffer | Uint8Array,
  pageIndex: number,
  deltaDegrees = 90
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(toSafeUint8Array(pdfBuffer), { ignoreEncryption: true });
  if (pageIndex >= 0 && pageIndex < pdfDoc.getPageCount()) {
    const page = pdfDoc.getPage(pageIndex);
    const currentAngle = page.getRotation().angle;
    page.setRotation(degrees((currentAngle + deltaDegrees) % 360));
  }
  return await pdfDoc.save();
}

export async function reorderPdfPages(
  pdfBuffer: ArrayBuffer | Uint8Array,
  newOrder: number[]
): Promise<Uint8Array> {
  const srcPdf = await PDFDocument.load(toSafeUint8Array(pdfBuffer), { ignoreEncryption: true });
  const newPdf = await PDFDocument.create();
  const total = srcPdf.getPageCount();
  const validOrder = newOrder.filter((idx) => idx >= 0 && idx < total);
  const copied = await newPdf.copyPages(srcPdf, validOrder);
  copied.forEach((p) => newPdf.addPage(p));
  return await newPdf.save();
}

export async function compressPdf(pdfBuffer: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(toSafeUint8Array(pdfBuffer), { ignoreEncryption: true });
  return await pdfDoc.save({ useObjectStreams: true });
}

export async function countTextOccurrencesInPdf(
  pdfData: ArrayBuffer | Uint8Array,
  query: string
): Promise<{ totalMatches: number; pages: Array<{ pageNumber: number; matches: number }> }> {
  if (!query || !query.trim()) return { totalMatches: 0, pages: [] };
  const doc = await loadPdfForViewing(pdfData);
  try {
    const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const pages: Array<{ pageNumber: number; matches: number }> = [];
    let totalMatches = 0;

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map((it: any) => it.str || '').join(' ');
      const found = pageText.match(regex);
      const count = found ? found.length : 0;
      if (count > 0) {
        pages.push({ pageNumber: p, matches: count });
        totalMatches += count;
      }
    }
    return { totalMatches, pages };
  } finally {
    try {
      await doc?.cleanup?.();
      await (doc as any)?.destroy?.();
    } catch {
      // ignore cleanup failure
    }
  }
}

async function resolveImageBytesFromDataUrl(dataUrl: string): Promise<Uint8Array> {
  const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/i);
  if (base64Match) {
    const binary = atob(base64Match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  const response = await fetch(dataUrl);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Apply visual overlays (text notes, highlight boxes, signature PNG stamps,
 * watermarks, and page numbers) to a PDF. These are visual overlays only and
 * do not scrub underlying PDF text streams.
 */
export async function applyPdfAnnotations(
  pdfBuffer: ArrayBuffer | Uint8Array,
  annotations: PDFAnnotation[],
  options?: { watermarkText?: string; addPageNumbers?: boolean }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(toSafeUint8Array(pdfBuffer), { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  if (options?.watermarkText) {
    const safeWatermark = options.watermarkText.replace(/[^\x20-\x7E]/g, '?');
    for (const page of pages) {
      const { width, height } = page.getSize();
      page.drawText(safeWatermark, {
        x: width / 5,
        y: height / 2,
        size: 46,
        font: boldFont,
        color: rgb(0.65, 0.68, 0.75),
        opacity: 0.35,
        rotate: degrees(42),
      });
    }
  }

  if (options?.addPageNumbers) {
    const total = pages.length;
    pages.forEach((page, i) => {
      const { width } = page.getSize();
      page.drawText(`Page ${i + 1} of ${total}`, {
        x: Math.max(24, width / 2 - 30),
        y: 22,
        size: 10,
        font: helveticaFont,
        color: rgb(0.3, 0.3, 0.35),
      });
    });
  }

  for (const ann of annotations) {
    if (ann.pageIndex < 0 || ann.pageIndex >= pages.length) continue;
    const page = pages[ann.pageIndex];
    const { height } = page.getSize();
    const pdfY = Math.max(24, height - ann.y);

    if (ann.type === 'text' && ann.text) {
      page.drawText(ann.text.replace(/[^\x20-\x7E]/g, '?'), {
        x: ann.x,
        y: pdfY,
        size: ann.fontSize || 14,
        font: helveticaFont,
        color: hexToRgb(ann.color || '#111827'),
        opacity: ann.opacity ?? 1,
      });
    } else if (ann.type === 'highlight') {
      const boxHeight = ann.height || 20;
      page.drawRectangle({
        x: ann.x,
        y: Math.max(0, height - ann.y - boxHeight),
        width: ann.width || 140,
        height: boxHeight,
        color: hexToRgb(ann.color || '#fef08a'),
        opacity: ann.opacity ?? 0.45,
      });
    } else if (ann.type === 'rectangle') {
      const boxHeight = ann.height || 40;
      page.drawRectangle({
        x: ann.x,
        y: Math.max(0, height - ann.y - boxHeight),
        width: ann.width || 120,
        height: boxHeight,
        borderColor: hexToRgb(ann.color || '#3b82f6'),
        borderWidth: 2,
        opacity: ann.opacity ?? 1,
      });
    } else if (ann.type === 'underline') {
      const lineY = Math.max(4, height - ann.y - (ann.height || 14));
      page.drawLine({
        start: { x: ann.x, y: lineY },
        end: { x: ann.x + (ann.width || 80), y: lineY },
        thickness: 1.5,
        color: hexToRgb(ann.color || '#2563eb'),
      });
    } else if (ann.type === 'strikethrough') {
      const lineY = Math.max(4, height - ann.y - (ann.height || 14) / 2);
      page.drawLine({
        start: { x: ann.x, y: lineY },
        end: { x: ann.x + (ann.width || 80), y: lineY },
        thickness: 1.5,
        color: hexToRgb(ann.color || '#ef4444'),
      });
    } else if (ann.type === 'signature' && ann.dataUrl) {
      const sigHeight = ann.height || 60;
      const sigWidth = ann.width || 150;
      const imageBytes = await resolveImageBytesFromDataUrl(ann.dataUrl);
      const isJpeg =
        ann.dataUrl.startsWith('data:image/jpeg') || ann.dataUrl.startsWith('data:image/jpg');
      const embedded = isJpeg ? await pdfDoc.embedJpg(imageBytes) : await pdfDoc.embedPng(imageBytes);
      page.drawImage(embedded, {
        x: ann.x,
        y: Math.max(0, height - ann.y - sigHeight),
        width: sigWidth,
        height: sigHeight,
        opacity: ann.opacity ?? 1,
      });
    } else if (ann.type === 'image' && ann.dataUrl) {
      const imgHeight = ann.height || 80;
      const imgWidth = ann.width || 120;
      const imageBytes = await resolveImageBytesFromDataUrl(ann.dataUrl);
      const isJpeg =
        ann.dataUrl.startsWith('data:image/jpeg') || ann.dataUrl.startsWith('data:image/jpg');
      const embedded = isJpeg ? await pdfDoc.embedJpg(imageBytes) : await pdfDoc.embedPng(imageBytes);
      page.drawImage(embedded, {
        x: ann.x,
        y: Math.max(0, height - ann.y - imgHeight),
        width: imgWidth,
        height: imgHeight,
        opacity: ann.opacity ?? 1,
      });
    }
  }

  return await pdfDoc.save();
}

/**
 * Convert multiple camera-scanned images (JPEG/PNG) into a single A4 multi-page PDF.
 */
export async function imagesToPdf(
  images: Array<{ bytes: Uint8Array; mimeType: 'image/jpeg' | 'image/png' }>
): Promise<Uint8Array> {
  if (!images || images.length === 0) {
    throw new Error('At least one scanned image is required to create a PDF.');
  }

  const pdfDoc = await PDFDocument.create();
  for (const img of images) {
    const embedded =
      img.mimeType === 'image/png' ? await pdfDoc.embedPng(img.bytes) : await pdfDoc.embedJpg(img.bytes);
    const isLandscape = embedded.width > embedded.height;
    const pageWidth = isLandscape ? 841.89 : 595.28;
    const pageHeight = isLandscape ? 595.28 : 841.89;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const margin = 24;
    const scale = Math.min((pageWidth - margin * 2) / embedded.width, (pageHeight - margin * 2) / embedded.height);
    const drawW = embedded.width * scale;
    const drawH = embedded.height * scale;
    page.drawImage(embedded, {
      x: (pageWidth - drawW) / 2,
      y: (pageHeight - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }
  return await pdfDoc.save();
}

export async function verifyPdfIntegrity(
  pdfBytes: ArrayBuffer | Uint8Array
): Promise<{ valid: boolean; pageCount: number; sizeBytes: number; error?: string }> {
  try {
    const data = toSafeUint8Array(pdfBytes);
    const doc = await PDFDocument.load(data, { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    return { valid: pageCount > 0, pageCount, sizeBytes: data.byteLength };
  } catch (err: any) {
    return { valid: false, pageCount: 0, sizeBytes: 0, error: err?.message || 'Invalid PDF' };
  }
}

function hexToRgb(hex: string) {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return rgb(0, 0, 0);
  const r = parseInt(sanitized.substring(0, 2), 16) / 255;
  const g = parseInt(sanitized.substring(2, 4), 16) / 255;
  const b = parseInt(sanitized.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}
