import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';

export interface DocxTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface DocxContentItem {
  type: 'h1' | 'h2' | 'h3' | 'paragraph' | 'bullet' | 'table';
  text?: string;
  runs?: DocxTextRun[];
  tableData?: string[][];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
}

export async function createDocxBlob(title: string, items: DocxContentItem[]): Promise<Blob> {
  const children: (Paragraph | Table)[] = [];

  if (title) {
    children.push(
      new Paragraph({
        text: title,
        heading: HeadingLevel.TITLE,
        spacing: { after: 300 },
      })
    );
  }

  for (const item of items) {
    if (item.type === 'h1') {
      children.push(new Paragraph({ text: item.text || '', heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
    } else if (item.type === 'h2') {
      children.push(new Paragraph({ text: item.text || '', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    } else if (item.type === 'h3') {
      children.push(new Paragraph({ text: item.text || '', heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
    } else if (item.type === 'bullet') {
      children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(item.text || '')], spacing: { after: 80 } }));
    } else if (item.type === 'table' && item.tableData && item.tableData.length > 0) {
      const rows = item.tableData.map((rowCells, rowIndex) =>
        new TableRow({
          children: rowCells.map((cellText) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: cellText, bold: rowIndex === 0 })] })],
              width: { size: 100 / (rowCells.length || 1), type: WidthType.PERCENTAGE },
            })
          ),
        })
      );
      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    } else {
      let alignment: any = AlignmentType.LEFT;
      if (item.align === 'center') alignment = AlignmentType.CENTER;
      if (item.align === 'right') alignment = AlignmentType.RIGHT;

      const runs: TextRun[] =
        item.runs && item.runs.length > 0
          ? item.runs.map((r) => new TextRun({ text: r.text || '', bold: r.bold, italics: r.italic, underline: r.underline ? {} : undefined }))
          : [new TextRun({ text: item.text || '', bold: item.bold, italics: item.italic, underline: item.underline ? {} : undefined })];

      children.push(new Paragraph({ alignment, children: runs, spacing: { after: 140, line: 276 } }));
    }
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  return await Packer.toBlob(doc);
}

export async function extractTextFromDocxFile(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      throw new Error('word/document.xml not found in DOCX package');
    }
    const xmlText = await docXmlFile.async('text');
    const extractedLines: string[] = [];

    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const body = xmlDoc.getElementsByTagName('w:body')[0] || xmlDoc.documentElement;
      const childNodes = Array.from(body.childNodes);

      for (const node of childNodes) {
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        const tagName = el.tagName.toLowerCase();

        if (tagName.endsWith('tbl') || tagName === 'w:tbl') {
          const rows = Array.from(el.getElementsByTagName('w:tr'));
          const tableGrid: string[][] = [];
          for (const tr of rows) {
            const cells = Array.from(tr.getElementsByTagName('w:tc'));
            const rowValues = cells.map((tc) =>
              Array.from(tc.getElementsByTagName('w:t')).map((tn) => tn.textContent || '').join(' ').trim()
            );
            if (rowValues.some((v) => v.length > 0)) tableGrid.push(rowValues);
          }
          if (tableGrid.length > 0) {
            const colCount = Math.max(...tableGrid.map((r) => r.length));
            tableGrid.forEach((row, idx) => {
              while (row.length < colCount) row.push('');
              extractedLines.push(`| ${row.join(' | ')} |`);
              if (idx === 0) extractedLines.push(`| ${row.map(() => '---').join(' | ')} |`);
            });
            extractedLines.push('');
          }
        } else if (tagName.endsWith('p') || tagName === 'w:p') {
          let prefix = '';
          const pStyle = el.getElementsByTagName('w:pStyle')[0];
          if (pStyle) {
            const val = (pStyle.getAttribute('w:val') || '').toLowerCase();
            if (val.includes('heading1') || val === 'title') prefix = '# ';
            else if (val.includes('heading2')) prefix = '## ';
            else if (val.includes('heading3')) prefix = '### ';
          }
          const pText = Array.from(el.getElementsByTagName('w:t')).map((tn) => tn.textContent || '').join('');
          if (pText.trim()) extractedLines.push(`${prefix}${pText}`);
        }
      }
    } else {
      const tMatches = Array.from(xmlText.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/gs)).map((m) => m[1]);
      if (tMatches.length > 0) extractedLines.push(tMatches.join(' '));
    }

    return extractedLines.join('\n\n');
  } catch {
    return await file.text();
  }
}

export async function convertTextOrDocxToPdf(title: string, rawText: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const usableWidth = pageWidth - margin * 2;
  const fontSize = 11;
  const lineHeight = 16;

  let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - margin;

  if (title) {
    currentPage.drawText(title.slice(0, 80), {
      x: margin,
      y: cursorY,
      size: 18,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.2),
    });
    cursorY -= 30;
    currentPage.drawLine({
      start: { x: margin, y: cursorY + 10 },
      end: { x: pageWidth - margin, y: cursorY + 10 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.85),
    });
  }

  const paragraphs = rawText.split('\n');
  for (const para of paragraphs) {
    if (!para.trim()) {
      cursorY -= lineHeight;
      if (cursorY < margin) {
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        cursorY = pageHeight - margin;
      }
      continue;
    }

    const words = para.split(' ');
    let currentLine = '';
    for (const word of words) {
      const safeWord = word.replace(/[^\x20-\x7E]/g, '?');
      const testLine = currentLine ? `${currentLine} ${safeWord}` : safeWord;
      const textWidth = font.widthOfTextAtSize(testLine, fontSize);
      if (textWidth > usableWidth) {
        if (cursorY < margin) {
          currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
          cursorY = pageHeight - margin;
        }
        currentPage.drawText(currentLine, { x: margin, y: cursorY, size: fontSize, font, color: rgb(0.15, 0.15, 0.15) });
        cursorY -= lineHeight;
        currentLine = safeWord;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      if (cursorY < margin) {
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        cursorY = pageHeight - margin;
      }
      currentPage.drawText(currentLine, { x: margin, y: cursorY, size: fontSize, font, color: rgb(0.15, 0.15, 0.15) });
      cursorY -= lineHeight + 4;
    }
  }

  return await pdfDoc.save();
}
