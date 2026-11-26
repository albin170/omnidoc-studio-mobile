import JSZip from 'jszip';
import { ConversionJob, ConversionOptions, FileFormat } from '../types';
import { FORMAT_REGISTRY, validateFileFormat } from './formatDetector';
import { compressPdf, extractTextFromPdf, renderPdfPagesToImages } from './pdfService';
import { convertTextOrDocxToPdf, createDocxBlob, extractTextFromDocxFile, DocxContentItem } from './docxService';
import { convertSpreadsheetToPdf, exportDataToCsvBlob, exportDataToXlsxBlob, parseSpreadsheetFile } from './sheetService';
import { convertImageFormat, convertImageToPdf } from './imageService';
import { convertSlidesToPdf, createPresentationBlob, extractTextFromPptxFile } from './pptxService';

export interface ConversionResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
}

export interface ConversionCompatibilityReport {
  supported: boolean;
  fidelity: 'native' | 'extraction' | 'rasterized' | 'unsupported';
  label: string;
  summary: string;
  caveats: string[];
}

export function escapeHtml(str: string): string {
  if (typeof str !== 'string') str = String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function executeFileConversion(
  file: File,
  sourceFormat: FileFormat,
  targetFormat: FileFormat,
  options?: ConversionOptions,
  onProgress?: (progress: number, step: string) => void
): Promise<ConversionResult> {
  const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
  const updateProgress = (pct: number, msg: string) => {
    if (onProgress) onProgress(pct, msg);
  };
  const checkAborted = () => {
    if (options?.signal?.aborted) {
      throw new DOMException('Conversion cancelled by user', 'AbortError');
    }
  };

  if (!file || file.size === 0) {
    throw new Error(`File "${file?.name || 'unknown'}" is empty (0 bytes).`);
  }

  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File "${file.name}" exceeds the 100 MB mobile memory limit. Use Cloud conversion for larger files.`);
  }

  checkAborted();
  const allowed = FORMAT_REGISTRY[sourceFormat]?.allowedConversions || [];
  if (sourceFormat !== targetFormat && !allowed.includes(targetFormat)) {
    throw new Error(`Unsupported conversion route: ${sourceFormat.toUpperCase()} to ${targetFormat.toUpperCase()}`);
  }

  updateProgress(10, 'Validating file headers...');
  if (file.size >= 16) {
    const validation = await validateFileFormat(file);
    if (!validation.valid && validation.format !== sourceFormat && !['txt', 'html', 'md', 'csv'].includes(sourceFormat)) {
      throw new Error(validation.error || `File "${file.name}" failed format validation.`);
    }
  }
  checkAborted();

  if (sourceFormat === targetFormat) {
    if (sourceFormat === 'pdf') {
      updateProgress(45, 'Optimizing PDF object streams...');
      const arrayBuffer = await file.arrayBuffer();
      checkAborted();
      const optimizedBytes = await compressPdf(arrayBuffer);
      checkAborted();
      updateProgress(100, 'PDF optimization completed');
      return {
        blob: new Blob([optimizedBytes as any], { type: 'application/pdf' }),
        fileName: `${baseName}_optimized.pdf`,
        mimeType: 'application/pdf',
      };
    }

    updateProgress(100, 'Format match; ready');
    return {
      blob: file,
      fileName: file.name,
      mimeType: FORMAT_REGISTRY[targetFormat]?.mimeType || file.type,
    };
  }

  if (sourceFormat === 'pdf') {
    const arrayBuffer = await file.arrayBuffer();
    checkAborted();

    if (targetFormat === 'txt') {
      updateProgress(45, 'Extracting selectable text from PDF...');
      const text = await extractTextFromPdf(arrayBuffer);
      checkAborted();
      updateProgress(100, 'Text extracted');
      return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), fileName: `${baseName}.txt`, mimeType: 'text/plain' };
    }

    if (targetFormat === 'docx') {
      updateProgress(40, 'Extracting text stream...');
      const text = await extractTextFromPdf(arrayBuffer);
      checkAborted();
      const paragraphs: DocxContentItem[] = text.split('\n\n').filter(Boolean).map((p) => ({ type: 'paragraph', text: p }));
      updateProgress(75, 'Building DOCX package...');
      const docxBlob = await createDocxBlob(baseName, paragraphs);
      checkAborted();
      updateProgress(100, 'DOCX ready');
      return { blob: docxBlob, fileName: `${baseName}.docx`, mimeType: FORMAT_REGISTRY.docx.mimeType };
    }

    if (targetFormat === 'pptx') {
      updateProgress(40, 'Extracting PDF pages...');
      const text = await extractTextFromPdf(arrayBuffer);
      checkAborted();
      const pages = text.split(/--- Page \d+ ---/).filter((p) => p.trim());
      const slides = (pages.length > 0 ? pages : [text]).map((pageText, idx) => {
        const lines = pageText.trim().split('\n').filter(Boolean);
        const title = lines[0] || `Slide ${idx + 1}`;
        const body = lines.slice(1).join('\n') || 'Extracted page content';
        return {
          id: `s-${idx + 1}`,
          title,
          bgColor: idx % 2 === 0 ? '#0f172a' : '#1e1b4b',
          layout: 'content' as const,
          elements: [
            { id: `el-t-${idx}`, type: 'title' as const, content: title.slice(0, 80), x: 8, y: 12, width: 84, height: 18, fontSize: 28, fontColor: '#ffffff' },
            { id: `el-b-${idx}`, type: 'text' as const, content: body.slice(0, 600), x: 8, y: 35, width: 84, height: 55, fontSize: 16, fontColor: '#cbd5e1' },
          ],
        };
      });
      const pptxBlob = await createPresentationBlob(baseName, slides);
      checkAborted();
      updateProgress(100, 'PPTX ready');
      return { blob: pptxBlob, fileName: `${baseName}.pptx`, mimeType: FORMAT_REGISTRY.pptx.mimeType };
    }

    if (targetFormat === 'png' || targetFormat === 'jpg') {
      updateProgress(35, 'Rendering PDF pages to images...');
      const imageBlobs = await renderPdfPagesToImages(arrayBuffer, targetFormat === 'png' ? 'png' : 'jpeg');
      checkAborted();
      if (imageBlobs.length === 1) {
        updateProgress(100, 'Rendered page image');
        return { blob: imageBlobs[0], fileName: `${baseName}.${targetFormat}`, mimeType: targetFormat === 'png' ? 'image/png' : 'image/jpeg' };
      }
      const zip = new JSZip();
      imageBlobs.forEach((b, idx) => zip.file(`${baseName}_page_${idx + 1}.${targetFormat}`, b));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      checkAborted();
      updateProgress(100, 'Packaged pages ZIP');
      return { blob: zipBlob, fileName: `${baseName}_pages.zip`, mimeType: 'application/zip' };
    }
  }

  if (sourceFormat === 'docx') {
    updateProgress(35, 'Parsing DOCX XML...');
    const rawText = await extractTextFromDocxFile(file);
    checkAborted();
    if (targetFormat === 'pdf') {
      updateProgress(70, 'Rendering PDF...');
      const pdfBytes = await convertTextOrDocxToPdf(baseName, rawText);
      checkAborted();
      updateProgress(100, 'PDF ready');
      return { blob: new Blob([pdfBytes as any], { type: 'application/pdf' }), fileName: `${baseName}.pdf`, mimeType: 'application/pdf' };
    }
    if (targetFormat === 'txt') {
      updateProgress(100, 'Text extracted');
      return { blob: new Blob([rawText], { type: 'text/plain;charset=utf-8' }), fileName: `${baseName}.txt`, mimeType: 'text/plain' };
    }
    if (targetFormat === 'html') {
      const escapedTitle = escapeHtml(baseName);
      const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapedTitle}</title></head><body><h1>${escapedTitle}</h1>${rawText
        .split('\n\n')
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('\n')}</body></html>`;
      updateProgress(100, 'HTML ready');
      return { blob: new Blob([htmlContent], { type: 'text/html;charset=utf-8' }), fileName: `${baseName}.html`, mimeType: 'text/html' };
    }
  }

  if (sourceFormat === 'pptx') {
    updateProgress(35, 'Parsing PPTX slides...');
    const slideTexts = await extractTextFromPptxFile(file);
    checkAborted();
    if (targetFormat === 'txt') {
      const combined = slideTexts.map((st, i) => `--- Slide ${i + 1} ---\n${st}`).join('\n\n');
      updateProgress(100, 'Text extracted');
      return { blob: new Blob([combined], { type: 'text/plain;charset=utf-8' }), fileName: `${baseName}.txt`, mimeType: 'text/plain' };
    }
    if (targetFormat === 'docx') {
      const paragraphs: DocxContentItem[] = [];
      slideTexts.forEach((st, idx) => {
        paragraphs.push({ type: 'h2', text: `Slide ${idx + 1}` });
        st.split('\n').filter(Boolean).forEach((line) => paragraphs.push({ type: 'paragraph', text: line }));
      });
      const docxBlob = await createDocxBlob(baseName, paragraphs);
      checkAborted();
      updateProgress(100, 'DOCX ready');
      return { blob: docxBlob, fileName: `${baseName}.docx`, mimeType: FORMAT_REGISTRY.docx.mimeType };
    }
    if (targetFormat === 'pdf' || targetFormat === 'png' || targetFormat === 'jpg') {
      const slides = slideTexts.map((st, idx) => {
        const lines = st.split('\n').filter(Boolean);
        return {
          id: `s-${idx + 1}`,
          title: lines[0] || `Slide ${idx + 1}`,
          bgColor: '#0f172a',
          layout: 'content' as const,
          elements: [
            { id: `el-t-${idx}`, type: 'title' as const, content: lines[0] || `Slide ${idx + 1}`, x: 8, y: 12, width: 84, height: 18, fontSize: 28, fontColor: '#ffffff' },
            { id: `el-b-${idx}`, type: 'text' as const, content: lines.slice(1).join('\n'), x: 8, y: 35, width: 84, height: 55, fontSize: 16, fontColor: '#cbd5e1' },
          ],
        };
      });
      const pdfBytes = await convertSlidesToPdf(baseName, slides);
      checkAborted();
      if (targetFormat === 'pdf') {
        updateProgress(100, 'PDF ready');
        return { blob: new Blob([pdfBytes as any], { type: 'application/pdf' }), fileName: `${baseName}.pdf`, mimeType: 'application/pdf' };
      }
      updateProgress(70, 'Rendering slide images...');
      const images = await renderPdfPagesToImages(pdfBytes, targetFormat === 'png' ? 'png' : 'jpeg');
      checkAborted();
      if (images.length === 1) {
        updateProgress(100, 'Slide image ready');
        return { blob: images[0], fileName: `${baseName}.${targetFormat}`, mimeType: targetFormat === 'png' ? 'image/png' : 'image/jpeg' };
      }
      const zip = new JSZip();
      images.forEach((imgBlob, idx) => zip.file(`${baseName}_slide_${idx + 1}.${targetFormat}`, imgBlob));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      updateProgress(100, 'Packaged slides ZIP');
      return { blob: zipBlob, fileName: `${baseName}_slides.zip`, mimeType: 'application/zip' };
    }
  }

  if (sourceFormat === 'xlsx' || sourceFormat === 'csv') {
    updateProgress(40, 'Parsing spreadsheet workbook...');
    const parsed = await parseSpreadsheetFile(file);
    checkAborted();
    if (targetFormat === 'csv') {
      updateProgress(100, 'CSV exported');
      return { blob: exportDataToCsvBlob(parsed.data), fileName: `${baseName}.csv`, mimeType: 'text/csv' };
    }
    if (targetFormat === 'xlsx') {
      updateProgress(100, 'XLSX exported');
      return { blob: exportDataToXlsxBlob(parsed.data, parsed.activeSheet), fileName: `${baseName}.xlsx`, mimeType: FORMAT_REGISTRY.xlsx.mimeType };
    }
    if (targetFormat === 'pdf') {
      const pdfBytes = await convertSpreadsheetToPdf(parsed.data, baseName);
      checkAborted();
      updateProgress(100, 'PDF exported');
      return { blob: new Blob([pdfBytes as any], { type: 'application/pdf' }), fileName: `${baseName}.pdf`, mimeType: 'application/pdf' };
    }
    if (targetFormat === 'html') {
      const rows = parsed.data
        .filter((r) => r.some((c) => c !== ''))
        .map((row, idx) => {
          const tag = idx === 0 ? 'th' : 'td';
          return `<tr>${row.map((c) => `<${tag}>${escapeHtml(String(c ?? ''))}</${tag}>`).join('')}</tr>`;
        })
        .join('\n');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(baseName)}</title></head><body><table>${rows}</table></body></html>`;
      updateProgress(100, 'HTML exported');
      return { blob: new Blob([html], { type: 'text/html;charset=utf-8' }), fileName: `${baseName}.html`, mimeType: 'text/html' };
    }
    if (targetFormat === 'txt') {
      const txt = parsed.data.map((row) => row.join('\t')).join('\n');
      updateProgress(100, 'Text exported');
      return { blob: new Blob([txt], { type: 'text/plain;charset=utf-8' }), fileName: `${baseName}.txt`, mimeType: 'text/plain' };
    }
  }

  if (['png', 'jpg', 'webp'].includes(sourceFormat)) {
    if (targetFormat === 'pdf') {
      updateProgress(55, 'Embedding image into PDF...');
      const pdfBytes = await convertImageToPdf(file, {
        pageSize: options?.pageOrientation ? 'A4' : 'fit',
        orientation: options?.pageOrientation,
      });
      checkAborted();
      updateProgress(100, 'PDF ready');
      return { blob: new Blob([pdfBytes as any], { type: 'application/pdf' }), fileName: `${baseName}.pdf`, mimeType: 'application/pdf' };
    }
    if (['png', 'jpg', 'webp'].includes(targetFormat)) {
      updateProgress(55, `Transcoding to ${targetFormat.toUpperCase()}...`);
      const blob = await convertImageFormat(file, targetFormat as 'png' | 'jpg' | 'webp', options?.quality ?? 0.92);
      checkAborted();
      updateProgress(100, 'Image converted');
      return { blob, fileName: `${baseName}.${targetFormat}`, mimeType: FORMAT_REGISTRY[targetFormat].mimeType };
    }
  }

  if (['txt', 'md', 'html'].includes(sourceFormat)) {
    const rawText = await file.text();
    checkAborted();
    if (targetFormat === 'pdf') {
      updateProgress(65, 'Rendering PDF...');
      const pdfBytes = await convertTextOrDocxToPdf(baseName, rawText);
      checkAborted();
      updateProgress(100, 'PDF ready');
      return { blob: new Blob([pdfBytes as any], { type: 'application/pdf' }), fileName: `${baseName}.pdf`, mimeType: 'application/pdf' };
    }
    if (targetFormat === 'docx') {
      const paragraphs: DocxContentItem[] = rawText.split('\n\n').filter(Boolean).map((p) => ({ type: 'paragraph', text: p }));
      const docxBlob = await createDocxBlob(baseName, paragraphs);
      checkAborted();
      updateProgress(100, 'DOCX ready');
      return { blob: docxBlob, fileName: `${baseName}.docx`, mimeType: FORMAT_REGISTRY.docx.mimeType };
    }
    if (targetFormat === 'html') {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(baseName)}</title></head><body><h1>${escapeHtml(baseName)}</h1><pre>${escapeHtml(rawText)}</pre></body></html>`;
      updateProgress(100, 'HTML ready');
      return { blob: new Blob([html], { type: 'text/html;charset=utf-8' }), fileName: `${baseName}.html`, mimeType: 'text/html' };
    }
    if (targetFormat === 'txt') {
      let cleaned = rawText;
      if (sourceFormat === 'html' && typeof DOMParser !== 'undefined') {
        cleaned = new DOMParser().parseFromString(rawText, 'text/html').body.textContent || '';
      }
      updateProgress(100, 'Text ready');
      return { blob: new Blob([cleaned], { type: 'text/plain;charset=utf-8' }), fileName: `${baseName}.txt`, mimeType: 'text/plain' };
    }
  }

  throw new Error(`Unsupported conversion route: ${sourceFormat.toUpperCase()} to ${targetFormat.toUpperCase()}`);
}

/**
 * Package multiple completed conversion jobs into a single compressed ZIP archive,
 * deduplicating colliding output filenames across batch items.
 */
export async function createBatchZipArchive(jobs: ConversionJob[]): Promise<Blob> {
  const completed = jobs.filter((job) => job.status === 'completed' && job.resultBlob);
  if (completed.length === 0) {
    throw new Error('No completed conversion outputs are ready to package.');
  }

  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  for (const job of completed) {
    const rawName = job.resultFileName || `${job.sourceFile.name}.${job.targetFormat}`;
    const count = usedNames.get(rawName) || 0;
    usedNames.set(rawName, count + 1);

    let uniqueName = rawName;
    if (count > 0) {
      const dotIdx = rawName.lastIndexOf('.');
      uniqueName =
        dotIdx > 0
          ? `${rawName.slice(0, dotIdx)}_${count + 1}${rawName.slice(dotIdx)}`
          : `${rawName}_${count + 1}`;
    }

    zip.file(uniqueName, job.resultBlob!);
  }

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Explains conversion fidelity and potential formatting trade-offs before execution.
 */
export function getConversionCompatibilityReport(
  sourceFormat: FileFormat,
  targetFormat: FileFormat
): ConversionCompatibilityReport {
  if (sourceFormat === targetFormat) {
    return {
      supported: true,
      fidelity: 'native',
      label: sourceFormat === 'pdf' ? 'Optimize PDF Streams' : 'Exact Passthrough',
      summary: 'Preserves original document structure and content.',
      caveats: sourceFormat === 'pdf' ? ['Re-saves PDF with compressed object streams.'] : [],
    };
  }

  const allowed = FORMAT_REGISTRY[sourceFormat]?.allowedConversions || [];
  if (!allowed.includes(targetFormat)) {
    return {
      supported: false,
      fidelity: 'unsupported',
      label: 'Unsupported Route',
      summary: `Direct conversion from ${sourceFormat.toUpperCase()} to ${targetFormat.toUpperCase()} is not supported.`,
      caveats: ['Choose a compatible destination format from the Conversion Matrix.'],
    };
  }

  if (['png', 'jpg', 'webp'].includes(sourceFormat) && ['png', 'jpg', 'webp', 'pdf'].includes(targetFormat)) {
    return {
      supported: true,
      fidelity: 'native',
      label: 'High-Fidelity Raster',
      summary: 'Direct pixel transcoding or embedded image PDF generation.',
      caveats: targetFormat === 'jpg' ? ['JPG does not support alpha transparency (transparent areas become solid).'] : [],
    };
  }

  if (['xlsx', 'csv'].includes(sourceFormat) && ['xlsx', 'csv', 'html'].includes(targetFormat)) {
    return {
      supported: true,
      fidelity: 'native',
      label: 'Tabular Structure Preserved',
      summary: 'Cell values and tabular rows/columns map cleanly across formats.',
      caveats: targetFormat === 'csv' ? ['CSV exports the active sheet values without formulas or multi-tab styling.'] : [],
    };
  }

  if (targetFormat === 'png' || targetFormat === 'jpg' || targetFormat === 'webp') {
    return {
      supported: true,
      fidelity: 'rasterized',
      label: 'Visual Rasterization',
      summary: 'Pages or slides are rendered into high-DPI images packaged as a ZIP when multi-page.',
      caveats: ['Output is rasterized; text will no longer be selectable.'],
    };
  }

  return {
    supported: true,
    fidelity: 'extraction',
    label: 'Structure & Text Extraction',
    summary: `Extracts text, headings, and tabular content from ${sourceFormat.toUpperCase()} into ${targetFormat.toUpperCase()}.`,
    caveats: [
      'Complex multi-column layouts, custom embedded fonts, or animations may be simplified.',
      sourceFormat === 'pdf' ? 'Scanned image-only PDFs contain no selectable text stream.' : '',
    ].filter(Boolean),
  };
}
