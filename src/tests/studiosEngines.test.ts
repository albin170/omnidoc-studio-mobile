import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { executeFileConversion } from '../engines/converter';
import {
  applyPdfAnnotations,
  deletePdfPage,
  mergePdfFiles,
  rotatePdfPage,
  splitPdfByRange,
  verifyPdfIntegrity,
} from '../engines/pdfService';
import {
  convertSpreadsheetToPdf,
  evaluateCellFormula,
  exportDataToCsvBlob,
  exportDataToXlsxBlob,
  parseSpreadsheetFile,
  removeDuplicateRows,
  sortSheetRows,
} from '../engines/sheetService';

async function createSamplePdf(pagesCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pagesCount; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`OmniDoc Mobile Test Page ${i + 1}`, { x: 50, y: 750, size: 16 });
  }
  return await doc.save();
}

describe('Mobile Document Engines (PDF, Converter, Sheets)', () => {
  it('performs real PDF merge, split, rotate, delete, watermark and integrity verification', async () => {
    const pdfA = await createSamplePdf(2);
    const pdfB = await createSamplePdf(1);

    const merged = await mergePdfFiles([pdfA.buffer as ArrayBuffer, pdfB.buffer as ArrayBuffer]);
    expect((await verifyPdfIntegrity(merged)).pageCount).toBe(3);

    const split = await splitPdfByRange(merged, 2, 3);
    expect((await verifyPdfIntegrity(split)).pageCount).toBe(2);

    const rotated = await rotatePdfPage(split, 0, 90);
    const loadedRotated = await PDFDocument.load(rotated);
    expect(loadedRotated.getPage(0).getRotation().angle).toBe(90);

    const deleted = await deletePdfPage(rotated, 1);
    expect((await verifyPdfIntegrity(deleted)).pageCount).toBe(1);

    const watermarked = await applyPdfAnnotations(deleted, [], { watermarkText: 'MOBILE', addPageNumbers: true });
    expect((await verifyPdfIntegrity(watermarked)).valid).toBe(true);
  });

  it('executes real file conversions across TXT->PDF, CSV->XLSX, and MD->HTML', async () => {
    const txtFile = new File(['Hello OmniDoc Mobile\nLine 2'], 'notes.txt', { type: 'text/plain' });
    const pdfRes = await executeFileConversion(txtFile, 'txt', 'pdf');
    expect(pdfRes.fileName).toBe('notes.pdf');
    const pdfCheck = await verifyPdfIntegrity(new Uint8Array(await pdfRes.blob.arrayBuffer()));
    expect(pdfCheck.valid).toBe(true);

    const csvFile = new File(['Name,Qty,Total\nItemA,2,50\nItemB,3,90'], 'sales.csv', { type: 'text/csv' });
    const xlsxRes = await executeFileConversion(csvFile, 'csv', 'xlsx');
    expect(xlsxRes.fileName).toBe('sales.xlsx');
    expect(xlsxRes.blob.size).toBeGreaterThan(100);

    const mdFile = new File(['# Heading\nBody content'], 'readme.md', { type: 'text/markdown' });
    const htmlRes = await executeFileConversion(mdFile, 'md', 'html');
    expect(await htmlRes.blob.text()).toContain('<h1>');
  });

  it('evaluates Excel formulas, deduplicates, sorts, and exports XLSX/CSV/PDF', async () => {
    const grid: (string | number)[][] = [
      ['Item', 'Amount'],
      ['Beta', 30],
      ['Alpha', 10],
      ['Alpha', 10],
      ['Total', '=SUM(B2:B4)'],
    ];

    expect(evaluateCellFormula('=SUM(B2:B4)', grid)).toBe(50);
    expect(evaluateCellFormula('=AVERAGE(B2:B3)', grid)).toBe(20);
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
});
