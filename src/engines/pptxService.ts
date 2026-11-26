import pptxgen from 'pptxgenjs';
import { PDFDocument, PDFFont, rgb, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { SlideItem } from '../types';

export async function extractTextFromPptxFile(file: File): Promise<string[]> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slideNames = Object.keys(zip.files)
      .filter((name) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
      .sort((a, b) => {
        const aNum = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
        const bNum = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
        return aNum - bNum;
      });

    if (slideNames.length === 0) {
      throw new Error('No slides found in PPTX archive');
    }

    const slidesText: string[] = [];
    for (const sName of slideNames) {
      const xml = await zip.files[sName].async('text');
      const lines: string[] = [];
      if (typeof DOMParser !== 'undefined') {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, 'text/xml');
        const paragraphs = xmlDoc.getElementsByTagName('a:p');
        if (paragraphs.length > 0) {
          for (let i = 0; i < paragraphs.length; i++) {
            const tNodes = paragraphs[i].getElementsByTagName('a:t');
            let paraLine = '';
            for (let j = 0; j < tNodes.length; j++) {
              paraLine += tNodes[j].textContent || '';
            }
            if (paraLine.trim()) lines.push(paraLine.trim());
          }
        } else {
          const textNodes = xmlDoc.getElementsByTagName('a:t');
          for (let i = 0; i < textNodes.length; i++) {
            const text = textNodes[i].textContent?.trim();
            if (text) lines.push(text);
          }
        }
      } else {
        const tMatches = Array.from(xml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/gs))
          .map((m) => m[1]?.trim())
          .filter(Boolean);
        lines.push(...tMatches);
      }
      if (lines.length > 0) slidesText.push(lines.join('\n'));
    }
    return slidesText.length > 0 ? slidesText : ['Untitled Slide Content'];
  } catch {
    return [await file.text()];
  }
}

export async function createPresentationBlob(presentationTitle: string, slides: SlideItem[]): Promise<Blob> {
  const pptx = new pptxgen();
  pptx.title = presentationTitle || 'OmniDoc Presentation';
  pptx.layout = 'LAYOUT_16x9';

  for (const slideData of slides) {
    const slide = pptx.addSlide();
    if (slideData.bgColor) {
      slide.background = { color: slideData.bgColor.replace('#', '') };
    }
    for (const el of slideData.elements) {
      const xInch = (el.x / 100) * 10;
      const yInch = (el.y / 100) * 5.625;
      const wInch = (el.width / 100) * 10;
      const hInch = (el.height / 100) * 5.625;

      if (el.type === 'title') {
        slide.addText(el.content || '', {
          x: xInch,
          y: yInch,
          w: wInch,
          h: hInch,
          fontSize: el.fontSize || 32,
          bold: true,
          color: (el.fontColor || '#ffffff').replace('#', ''),
          align: 'left',
          valign: 'middle',
        });
      } else if (el.type === 'text') {
        slide.addText(el.content || '', {
          x: xInch,
          y: yInch,
          w: wInch,
          h: hInch,
          fontSize: el.fontSize || 16,
          color: (el.fontColor || '#e2e8f0').replace('#', ''),
          align: 'left',
          valign: 'top',
        });
      } else if (el.type === 'shape') {
        slide.addShape(pptx.ShapeType.rect, {
          x: xInch,
          y: yInch,
          w: wInch,
          h: hInch,
          fill: { color: (el.bgColor || '#334155').replace('#', '') },
          line: { color: '475569', width: 1 },
        });
      }
    }
  }

  const output = await pptx.write({ outputType: 'blob' });
  return output as Blob;
}

function toSafePdfText(input: string): string {
  return input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, '?');
}

function wrapTextToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const safe = toSafePdfText(text);
  if (!safe.trim()) return [''];
  const words = safe.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function convertSlidesToPdf(_title: string, slides: SlideItem[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const width = 960;
  const height = 540;

  for (let idx = 0; idx < slides.length; idx++) {
    const slide = slides[idx];
    const page = pdfDoc.addPage([width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height, color: hexToRgb(slide.bgColor || '#0f172a') });

    for (const el of slide.elements) {
      const elX = (el.x / 100) * width;
      const elY = height - (el.y / 100) * height - (el.height / 100) * height;
      const elW = Math.max(80, (el.width / 100) * width);
      const elH = (el.height / 100) * height;

      if (el.type === 'shape') {
        page.drawRectangle({ x: elX, y: elY, width: elW, height: elH, color: hexToRgb(el.bgColor || '#1e293b') });
      } else if (el.type === 'title') {
        const size = el.fontSize || 28;
        const titleLines = (el.content || '').split('\n').flatMap((l) => wrapTextToWidth(l, boldFont, size, elW));
        let textY = elY + elH - size;
        for (const line of titleLines.slice(0, 3)) {
          page.drawText(line, {
            x: elX,
            y: textY,
            size,
            font: boldFont,
            color: hexToRgb(el.fontColor || '#ffffff'),
          });
          textY -= size * 1.25;
        }
      } else if (el.type === 'text') {
        const size = el.fontSize || 16;
        const rawLines = (el.content || '').split('\n');
        let textY = elY + elH - size;
        for (const rawLine of rawLines) {
          const wrapped = wrapTextToWidth(rawLine, font, size, elW);
          for (const line of wrapped) {
            if (textY < 45) break;
            page.drawText(line, {
              x: elX,
              y: textY,
              size,
              font,
              color: hexToRgb(el.fontColor || '#cbd5e1'),
            });
            textY -= size * 1.4;
          }
        }
      }
    }

    page.drawText(`${idx + 1} / ${slides.length}`, {
      x: width - 70,
      y: 20,
      size: 11,
      font,
      color: rgb(0.65, 0.7, 0.8),
    });
  }

  return await pdfDoc.save();
}

function hexToRgb(hex: string) {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return rgb(0.1, 0.1, 0.15);
  const r = parseInt(sanitized.substring(0, 2), 16) / 255;
  const g = parseInt(sanitized.substring(2, 4), 16) / 255;
  const b = parseInt(sanitized.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}
