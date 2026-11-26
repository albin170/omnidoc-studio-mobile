import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  createBatchZipArchive,
  executeFileConversion,
  getConversionCompatibilityReport,
} from '../engines/converter';
import {
  convertTextOrDocxToPdf,
  createDocxBlob,
  extractTextFromDocxFile,
  htmlToDocxItems,
  sanitizeHtml,
} from '../engines/docxService';
import {
  applyPdfAnnotations,
  compressPdf,
  countTextOccurrencesInPdf,
  deletePdfPage,
  duplicatePdfPage,
  insertBlankPage,
  mergePdfFiles,
  reorderPdfPages,
  rotatePdfPage,
  splitPdfByRange,
  verifyPdfIntegrity,
} from '../engines/pdfService';
import {
  convertSlidesToPdf,
  createPresentationBlob,
  extractTextFromPptxFile,
} from '../engines/pptxService';
import {
  convertSpreadsheetToPdf,
  evaluateCellFormula,
  exportDataToCsvBlob,
  exportDataToXlsxBlob,
  parseSpreadsheetFile,
  removeDuplicateRows,
  sanitizeWorkbookData,
  sortSheetRows,
} from '../engines/sheetService';
import { ConversionJob, SlideItem } from '../types';

async function createSamplePdf(pagesCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pagesCount; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`OmniDoc Mobile Test Page ${i + 1} Alpha`, { x: 50, y: 750, size: 16 });
  }
  return await doc.save();
}

describe('Mobile Document Engines (PDF, Word, PowerPoint, Sheets, Batch Conversion)', () => {
  it('performs real PDF merge, split, rotate, delete, duplicate, insertBlank, reorder, compress, annotations, and search', async () => {
    const pdfA = await createSamplePdf(2);
    const pdfB = await createSamplePdf(1);

    const merged = await mergePdfFiles([pdfA.buffer as ArrayBuffer, pdfB.buffer as ArrayBuffer]);
    expect((await verifyPdfIntegrity(merged)).pageCount).toBe(3);

    const split = await splitPdfByRange(merged, 2, 3);
    expect((await verifyPdfIntegrity(split)).pageCount).toBe(2);

    const rotated = await rotatePdfPage(split, 0, 90);
    const loadedRotated = await PDFDocument.load(rotated);
    expect(loadedRotated.getPage(0).getRotation().angle).toBe(90);

    const duplicated = await duplicatePdfPage(rotated, 0);
    expect((await verifyPdfIntegrity(duplicated)).pageCount).toBe(3);

    const withBlank = await insertBlankPage(duplicated, 1);
    expect((await verifyPdfIntegrity(withBlank)).pageCount).toBe(4);

    const reordered = await reorderPdfPages(withBlank, [3, 0, 1, 2]);
    expect((await verifyPdfIntegrity(reordered)).pageCount).toBe(4);

    const deleted = await deletePdfPage(reordered, 1);
    expect((await verifyPdfIntegrity(deleted)).pageCount).toBe(3);

    const compressed = await compressPdf(deleted);
    expect((await verifyPdfIntegrity(compressed)).valid).toBe(true);

    const watermarked = await applyPdfAnnotations(
      compressed,
      [{ id: 'ann-1', pageIndex: 0, type: 'highlight', x: 40, y: 80, width: 120, height: 20 }],
      { watermarkText: 'MOBILE', addPageNumbers: true }
    );
    expect((await verifyPdfIntegrity(watermarked)).valid).toBe(true);

    const searchResult = await countTextOccurrencesInPdf(pdfA, 'Alpha');
    expect(searchResult.totalMatches).toBe(2);
    expect(searchResult.pages).toEqual([
      { pageNumber: 1, matches: 1 },
      { pageNumber: 2, matches: 1 },
    ]);
  });

  it('sanitizes untrusted HTML against XSS and performs DOCX build, extraction, and PDF export', async () => {
    const dirtyHtml = `
      <h1>Quarterly Report</h1>
      <script>alert('xss')</script>
      <iframe src="https://evil.example"></iframe>
      <p onclick="steal()">Safe paragraph <a href="javascript:alert(1)" style="color:red">Click</a></p>
      <ul><li>Bullet One</li></ul>
    `;
    const clean = sanitizeHtml(dirtyHtml);
    expect(clean.toLowerCase()).not.toContain('<script');
    expect(clean.toLowerCase()).not.toContain('<iframe');
    expect(clean.toLowerCase()).not.toContain('onclick');
    expect(clean.toLowerCase()).not.toContain('javascript:');
    expect(clean).toContain('Quarterly Report');
    expect(clean).toContain('Bullet One');

    const items = htmlToDocxItems(clean);
    expect(items.some((i) => i.type === 'h1')).toBe(true);
    expect(items.some((i) => i.type === 'bullet')).toBe(true);

    const docxBlob = await createDocxBlob('Quarterly Report', items);
    expect(docxBlob.size).toBeGreaterThan(500);

    const docxFile = new File([docxBlob], 'report.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const extracted = await extractTextFromDocxFile(docxFile);
    expect(extracted).toContain('Quarterly Report');
    expect(extracted).toContain('Safe paragraph');

    const pdfBytes = await convertTextOrDocxToPdf('Quarterly Report', extracted);
    expect((await verifyPdfIntegrity(pdfBytes)).valid).toBe(true);
  });

  it('creates valid PPTX decks, extracts slide text, and exports slides to PDF', async () => {
    const slides: SlideItem[] = [
      {
        id: 's1',
        title: 'Intro',
        bgColor: '#0f172a',
        layout: 'title',
        elements: [
          { id: 'e1', type: 'title', content: 'Mobile Roadmap 2026', x: 10, y: 20, width: 80, height: 20, fontSize: 32, fontColor: '#ffffff' },
          { id: 'e2', type: 'text', content: 'Offline-first Android engineering', x: 10, y: 45, width: 80, height: 30, fontSize: 16, fontColor: '#cbd5e1' },
        ],
      },
      {
        id: 's2',
        title: 'Metrics',
        bgColor: '#1e1b4b',
        layout: 'content',
        elements: [
          { id: 'e3', type: 'title', content: 'Key Milestones', x: 10, y: 15, width: 80, height: 18 },
        ],
      },
    ];

    const pptxBlob = await createPresentationBlob('Mobile Roadmap', slides);
    expect(pptxBlob.size).toBeGreaterThan(500);

    const pptxFile = new File([pptxBlob], 'roadmap.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const extractedSlides = await extractTextFromPptxFile(pptxFile);
    expect(extractedSlides.length).toBeGreaterThanOrEqual(2);
    expect(extractedSlides.join('\n')).toContain('Mobile Roadmap 2026');

    const pdfBytes = await convertSlidesToPdf('Mobile Roadmap', slides);
    const check = await verifyPdfIntegrity(pdfBytes);
    expect(check.valid).toBe(true);
    expect(check.pageCount).toBe(2);
  });

  it('evaluates Excel formulas, sanitizes prototype pollution, deduplicates, sorts, and exports XLSX/CSV/PDF', async () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"safe":42}');
    const cleaned = sanitizeWorkbookData(polluted);
    expect((cleaned as any).polluted).toBeUndefined();
    expect(cleaned.safe).toBe(42);

    const grid: (string | number)[][] = [
      ['Item', 'Amount'],
      ['Beta', 30],
      ['Alpha', 10],
      ['Alpha', 10],
      ['Total', '=SUM(B2:B4)'],
    ];

    expect(evaluateCellFormula('=SUM(B2:B4)', grid)).toBe(50);
    expect(evaluateCellFormula('=AVERAGE(B2:B3)', grid)).toBe(20);
    expect(evaluateCellFormula('=MIN(B2:B4)', grid)).toBe(10);
    expect(evaluateCellFormula('=MAX(B2:B4)', grid)).toBe(30);
    expect(evaluateCellFormula('=COUNT(B2:B4)', grid)).toBe(3);
    expect(evaluateCellFormula('=IF(B2>20,"HIGH","LOW")', grid)).toBe('HIGH');

    const dedup = removeDuplicateRows(grid.slice(0, 4), true);
    expect(dedup.removedCount).toBe(1);
    expect(dedup.data).toHaveLength(3);

    const sorted = sortSheetRows(dedup.data, 0, true, true);
    expect(sorted[1][0]).toBe('Alpha');
    expect(sorted[2][0]).toBe('Beta');

    const xlsxBlob = exportDataToXlsxBlob(grid, 'Budget');
    const parsed = await parseSpreadsheetFile(new File([xlsxBlob], 'budget.xlsx'));
    expect(parsed.sheetNames).toContain('Budget');

    const csvBlob = exportDataToCsvBlob(grid);
    expect(await csvBlob.text()).toContain('Beta,30');

    const pdfBytes = await convertSpreadsheetToPdf(grid, 'Budget Report');
    expect((await verifyPdfIntegrity(pdfBytes)).valid).toBe(true);
  });

  it('executes file conversions, builds deduplicated batch ZIP archives, and generates compatibility reports', async () => {
    const txtFile = new File(['Hello OmniDoc Mobile\nLine 2'], 'notes.txt', { type: 'text/plain' });
    const pdfRes = await executeFileConversion(txtFile, 'txt', 'pdf');
    expect(pdfRes.fileName).toBe('notes.pdf');
    expect((await verifyPdfIntegrity(new Uint8Array(await pdfRes.blob.arrayBuffer()))).valid).toBe(true);

    const csvFile = new File(['Name,Qty,Total\nItemA,2,50\nItemB,3,90'], 'sales.csv', { type: 'text/csv' });
    const xlsxRes = await executeFileConversion(csvFile, 'csv', 'xlsx');
    expect(xlsxRes.fileName).toBe('sales.xlsx');
    expect(xlsxRes.blob.size).toBeGreaterThan(100);

    const mdFile = new File(['# Heading\nBody content'], 'readme.md', { type: 'text/markdown' });
    const htmlRes = await executeFileConversion(mdFile, 'md', 'html');
    expect(await htmlRes.blob.text()).toContain('<h1>');

    const abortController = new AbortController();
    abortController.abort();
    await expect(
      executeFileConversion(txtFile, 'txt', 'pdf', { signal: abortController.signal })
    ).rejects.toThrow(/cancelled/i);

    const jobs: ConversionJob[] = [
      {
        id: 'j1',
        sourceFile: txtFile,
        sourceFormat: 'txt',
        targetFormat: 'pdf',
        status: 'completed',
        progress: 100,
        resultBlob: pdfRes.blob,
        resultFileName: 'notes.pdf',
        createdAt: Date.now(),
      },
      {
        id: 'j2',
        sourceFile: txtFile,
        sourceFormat: 'txt',
        targetFormat: 'pdf',
        status: 'completed',
        progress: 100,
        resultBlob: pdfRes.blob,
        resultFileName: 'notes.pdf',
        createdAt: Date.now(),
      },
    ];
    const zipBlob = await createBatchZipArchive(jobs);
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['notes.pdf', 'notes_2.pdf']);

    expect(getConversionCompatibilityReport('png', 'jpg').fidelity).toBe('native');
    expect(getConversionCompatibilityReport('pdf', 'png').fidelity).toBe('rasterized');
    expect(getConversionCompatibilityReport('pdf', 'docx').fidelity).toBe('extraction');
    expect(getConversionCompatibilityReport('png', 'xlsx').supported).toBe(false);
  });
});
