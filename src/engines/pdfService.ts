import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFAnnotation } from '../types';

// Configure PDF.js worker using local Vite-bundled module so PDF rendering works 100% offline inside Android WebView.
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
} catch (e) {
  console.warn('PDF.js local worker initialization warning:', e);
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

export async function renderPdfPageToCanvas(
  pdfJsDoc: any,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.0
): Promise<void> {
  const page = await pdfJsDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
}

export async function extractTextFromPdf(pdfBytes: ArrayBuffer | Uint8Array): Promise<string> {
  const pdfJsDoc = await loadPdfForViewing(pdfBytes);
  const numPages = pdfJsDoc.numPages;
  let fullText = '';

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfJsDoc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str || '').join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }

  return fullText.trim();
}

export async function renderPdfPagesToImages(
  pdfBytes: ArrayBuffer | Uint8Array,
  format: 'png' | 'jpeg' = 'png'
): Promise<Blob[]> {
  const pdfJsDoc = await loadPdfForViewing(pdfBytes);
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
    for (const page of pages) {
      const { width, height } = page.getSize();
      page.drawText(options.watermarkText, {
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
        x: width / 2 - 30,
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
