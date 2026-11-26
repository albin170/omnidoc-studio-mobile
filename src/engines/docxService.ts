import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

const DISALLOWED_TAGS_SELECTOR = 'script, iframe, object, embed, link, meta, applet, base, form';
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background']);

/**
 * Sanitize untrusted HTML against XSS vectors while preserving safe formatting tags.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    doc.querySelectorAll(DISALLOWED_TAGS_SELECTOR).forEach((node) => node.remove());

    doc.body.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const rawVal = attr.value;
        const normalizedVal = rawVal.replace(/[\u0000-\u0020]+/g, '').toLowerCase();

        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if (
          URL_ATTRS.has(name) &&
          (normalizedVal.startsWith('javascript:') ||
            normalizedVal.startsWith('vbscript:') ||
            normalizedVal.startsWith('data:text/html'))
        ) {
          el.removeAttribute(attr.name);
        } else if (name === 'style' && /(expression\s*\(|javascript:|vbscript:)/i.test(rawVal)) {
          el.removeAttribute(attr.name);
        }
      }
    });

    return doc.body.innerHTML;
  }

  return html
    .replace(/<(script|iframe|object|embed|applet)\b[\s\S]*?>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|link|meta|applet|base|form)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
    .replace(/\s(href|src|xlink:href|action|formaction|poster|background)\s*=\s*(?:"[^"]*(?:javascript|vbscript|data:text\/html):[^"]*"|'[^']*(?:javascript|vbscript|data:text\/html):[^']*'|(?:javascript|vbscript):[^\s>]*)/gi, '');
}

function parseAlignFromElement(el: Element): 'left' | 'center' | 'right' | undefined {
  const styleAlign = (el as HTMLElement).style?.textAlign?.toLowerCase();
  const attrAlign = el.getAttribute('align')?.toLowerCase();
  const align = styleAlign || attrAlign;
  if (align === 'center' || align === 'right' || align === 'left') {
    return align;
  }
  return undefined;
}

/**
 * Convert sanitized rich-text HTML into structured DocxContentItem records for DOCX packaging.
 */
export function htmlToDocxItems(html: string): DocxContentItem[] {
  const safeHtml = sanitizeHtml(html || '');
  if (!safeHtml.trim()) return [];

  if (typeof DOMParser === 'undefined') {
    const items: DocxContentItem[] = [];
    const trimmed = safeHtml.trim();

    if (/<[a-z][\s\S]*>/i.test(trimmed)) {
      const tagRegex = /<(h[1-3]|p|div|ul|ol|table)[^>]*>([\s\S]*?)<\/\1>/gi;
      let match: RegExpExecArray | null;
      while ((match = tagRegex.exec(trimmed)) !== null) {
        const tag = match[1].toLowerCase();
        const inner = match[2];
        const plain = inner.replace(/<[^>]+>/g, '').trim();

        if (tag === 'h1') {
          items.push({ type: 'h1', text: plain });
        } else if (tag === 'h2') {
          items.push({ type: 'h2', text: plain });
        } else if (tag === 'h3') {
          items.push({ type: 'h3', text: plain });
        } else if (tag === 'ul' || tag === 'ol') {
          for (const lim of inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
            const liText = lim[1].replace(/<[^>]+>/g, '').trim();
            if (liText) items.push({ type: 'bullet', text: liText });
          }
        } else if (tag === 'table') {
          const tableData: string[][] = [];
          for (const trm of inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
            const rowCells = Array.from(trm[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)).map((cm) =>
              cm[1].replace(/<[^>]+>/g, '').trim()
            );
            if (rowCells.length > 0) tableData.push(rowCells);
          }
          if (tableData.length > 0) items.push({ type: 'table', tableData });
        } else if (plain) {
          items.push({ type: 'paragraph', text: plain });
        }
      }
      if (items.length > 0) return items;
    }

    return trimmed
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        if (line.startsWith('# ')) return { type: 'h1', text: line.slice(2) };
        if (line.startsWith('## ')) return { type: 'h2', text: line.slice(3) };
        if (line.startsWith('### ')) return { type: 'h3', text: line.slice(4) };
        if (line.startsWith('- ') || line.startsWith('• ')) return { type: 'bullet', text: line.slice(2) };
        return { type: 'paragraph', text: line };
      });
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(safeHtml, 'text/html');
  const items: DocxContentItem[] = [];

  function extractRuns(node: Node): DocxTextRun[] {
    const runs: DocxTextRun[] = [];

    function walk(n: Node, isBold = false, isItalic = false, isUnderline = false) {
      if (n.nodeType === Node.TEXT_NODE) {
        const text = n.textContent || '';
        if (text) {
          runs.push({ text, bold: isBold, italic: isItalic, underline: isUnderline });
        }
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as HTMLElement;
        const tag = el.tagName.toUpperCase();
        if (tag === 'BR') {
          runs.push({ text: '\n', bold: isBold, italic: isItalic, underline: isUnderline });
          return;
        }
        const style = el.style;
        const nextBold =
          isBold || tag === 'B' || tag === 'STRONG' || style?.fontWeight === 'bold' || Number(style?.fontWeight) >= 600;
        const nextItalic = isItalic || tag === 'I' || tag === 'EM' || style?.fontStyle === 'italic';
        const nextUnderline = isUnderline || tag === 'U' || (style?.textDecoration || '').includes('underline');

        for (let i = 0; i < el.childNodes.length; i++) {
          walk(el.childNodes[i], nextBold, nextItalic, nextUnderline);
        }
      }
    }

    walk(node);
    return runs.length > 0 ? runs : [{ text: node.textContent || '' }];
  }

  const children = Array.from(doc.body.children);
  if (children.length === 0) {
    const rawText = doc.body.textContent || '';
    if (rawText.trim()) {
      items.push({ type: 'paragraph', text: rawText.trim() });
    }
    return items;
  }

  for (const child of children) {
    const tag = child.tagName.toUpperCase();
    const align = parseAlignFromElement(child);

    if (tag === 'HR') continue;
    if (tag === 'H1') {
      items.push({ type: 'h1', text: child.textContent || '', align });
    } else if (tag === 'H2') {
      items.push({ type: 'h2', text: child.textContent || '', align });
    } else if (tag === 'H3') {
      items.push({ type: 'h3', text: child.textContent || '', align });
    } else if (tag === 'UL' || tag === 'OL') {
      child.querySelectorAll('li').forEach((li) => {
        const liRuns = extractRuns(li);
        items.push({ type: 'bullet', text: li.textContent || '', runs: liRuns });
      });
    } else if (tag === 'TABLE') {
      const tableData: string[][] = [];
      child.querySelectorAll('tr').forEach((tr) => {
        const rowCells: string[] = [];
        tr.querySelectorAll('th, td').forEach((cell) => {
          rowCells.push(cell.textContent?.trim() || '');
        });
        if (rowCells.length > 0) tableData.push(rowCells);
      });
      if (tableData.length > 0) items.push({ type: 'table', tableData });
    } else {
      const runs = extractRuns(child);
      const text = child.textContent || '';
      if (text.trim() || runs.some((r) => r.text.trim())) {
        items.push({ type: 'paragraph', text, runs, align });
      }
    }
  }

  return items;
}

function toDocxAlignment(align?: 'left' | 'center' | 'right') {
  if (align === 'center') return AlignmentType.CENTER;
  if (align === 'right') return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
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
      children.push(
        new Paragraph({
          text: item.text || '',
          heading: HeadingLevel.HEADING_1,
          alignment: toDocxAlignment(item.align),
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (item.type === 'h2') {
      children.push(
        new Paragraph({
          text: item.text || '',
          heading: HeadingLevel.HEADING_2,
          alignment: toDocxAlignment(item.align),
          spacing: { before: 200, after: 100 },
        })
      );
    } else if (item.type === 'h3') {
      children.push(
        new Paragraph({
          text: item.text || '',
          heading: HeadingLevel.HEADING_3,
          alignment: toDocxAlignment(item.align),
          spacing: { before: 160, after: 80 },
        })
      );
    } else if (item.type === 'bullet') {
      const bulletRuns: TextRun[] =
        item.runs && item.runs.length > 0
          ? item.runs.map(
              (r) =>
                new TextRun({
                  text: r.text || '',
                  bold: r.bold,
                  italics: r.italic,
                  underline: r.underline ? {} : undefined,
                })
            )
          : [new TextRun(item.text || '')];
      children.push(new Paragraph({ bullet: { level: 0 }, children: bulletRuns, spacing: { after: 80 } }));
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
      const runs: TextRun[] =
        item.runs && item.runs.length > 0
          ? item.runs.map(
              (r) =>
                new TextRun({
                  text: r.text || '',
                  bold: r.bold,
                  italics: r.italic,
                  underline: r.underline ? {} : undefined,
                })
            )
          : [
              new TextRun({
                text: item.text || '',
                bold: item.bold,
                italics: item.italic,
                underline: item.underline ? {} : undefined,
              }),
            ];

      children.push(
        new Paragraph({
          alignment: toDocxAlignment(item.align),
          children: runs,
          spacing: { after: 140, line: 276 },
        })
      );
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
              Array.from(tc.getElementsByTagName('w:t'))
                .map((tn) => tn.textContent || '')
                .join(' ')
                .trim()
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
          const pText = Array.from(el.getElementsByTagName('w:t'))
            .map((tn) => tn.textContent || '')
            .join('');
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

function toSafePdfAscii(input: string): string {
  return input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, '?');
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
    currentPage.drawText(toSafePdfAscii(title).slice(0, 80), {
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
      const safeWord = toSafePdfAscii(word);
      const testLine = currentLine ? `${currentLine} ${safeWord}` : safeWord;
      const textWidth = font.widthOfTextAtSize(testLine, fontSize);
      if (textWidth > usableWidth) {
        if (cursorY < margin) {
          currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
          cursorY = pageHeight - margin;
        }
        currentPage.drawText(currentLine, {
          x: margin,
          y: cursorY,
          size: fontSize,
          font,
          color: rgb(0.15, 0.15, 0.15),
        });
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
      currentPage.drawText(currentLine, {
        x: margin,
        y: cursorY,
        size: fontSize,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });
      cursorY -= lineHeight + 4;
    }
  }

  return await pdfDoc.save();
}
