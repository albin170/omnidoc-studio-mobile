import { PDFDocument, PDFName, PDFRef, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pakoNs from 'pako';
import { toSafeUint8Array } from './pdfService';

const pako = ((pakoNs as any).default || pakoNs) as typeof pakoNs;

export interface RedactionTarget {
  pageNumber: number; // 1-based
  x: number;
  y: number;
  width: number;
  height: number;
  textToRedact?: string;
  reason?: string;
}

export type RedactionVerificationStatus =
  | 'Verified'
  | 'Failed'
  | 'Incomplete verification'
  | 'Unsupported content detected';

export interface RedactionVerificationReport {
  status: RedactionVerificationStatus;
  isSanitized: boolean;
  totalPagesSanitized: number;
  redactionsApplied: number;
  residualTextFound: boolean;
  residualMatches: string[];
  metadataCleared: boolean;
  annotationsRemoved: number;
  embeddedFilesDetected: number;
  acroFormDetected: boolean;
  imagesDetectedOnRedactedPages: boolean;
  coordinateTargetsResolved: number;
  unresolvedCoordinateTargets: number;
  checksPerformed: string[];
  verificationError?: string;
  timestamp: string;
}

export interface SanitizedPdfResult {
  pdfBlob: Blob;
  pdfBytes: Uint8Array;
  report: RedactionVerificationReport;
}

function stringToHex(str: string): string {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex.toUpperCase();
}

export function scrubContentStream(streamText: string, targetWords: string[]): string {
  let result = streamText;
  for (const word of targetWords) {
    if (!word || word.trim().length === 0) continue;
    const cleanWord = word.trim();

    // 1. Literal text occurrences
    const literalPattern = new RegExp(cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(literalPattern, ' '.repeat(cleanWord.length));

    // 1b. PDF escaped parens \( and \)
    if (cleanWord.includes('(') || cleanWord.includes(')')) {
      const escapedWord = cleanWord.replace(/\(/g, '\\(').replace(/\)/g, '\\)');
      const escapedPattern = new RegExp(escapedWord.replace(/[.*+?^${}|[\]\\]/g, '\\$&'), 'gi');
      result = result.replace(escapedPattern, ' '.repeat(escapedWord.length));
    }

    // 2. Hex-encoded text occurrences
    const hexPatternUpper = stringToHex(cleanWord);
    const hexPatternLower = hexPatternUpper.toLowerCase();
    const hexReplacement = '20'.repeat(cleanWord.length);
    if (result.includes(hexPatternUpper)) {
      result = result.split(hexPatternUpper).join(hexReplacement);
    }
    if (result.includes(hexPatternLower)) {
      result = result.split(hexPatternLower).join(hexReplacement);
    }

    // 3. Kerning TJ arrays: supports both (literal) and <hex> segmented tokens
    const tjRegex = /\[\s*([\s\S]*?)\s*\]\s*TJ/g;
    result = result.replace(tjRegex, (fullMatch, tjInner) => {
      const tokens = Array.from(String(tjInner).matchAll(/(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>)/g));
      if (tokens.length === 0) return fullMatch;

      let combined = '';
      const decodedTokens: Array<{ raw: string; decoded: string; isHex: boolean }> = [];
      for (const m of tokens) {
        const tok = m[1];
        if (tok.startsWith('<')) {
          const hexOnly = tok.slice(1, -1).replace(/\s+/g, '');
          let decoded = '';
          for (let h = 0; h + 1 < hexOnly.length; h += 2) {
            decoded += String.fromCharCode(parseInt(hexOnly.slice(h, h + 2), 16));
          }
          combined += decoded;
          decodedTokens.push({ raw: tok, decoded, isHex: true });
        } else {
          const decoded = tok.slice(1, -1);
          combined += decoded;
          decodedTokens.push({ raw: tok, decoded, isHex: false });
        }
      }

      if (!combined.toLowerCase().includes(cleanWord.toLowerCase())) {
        return fullMatch;
      }

      let replacedInner = tjInner;
      for (const item of decodedTokens) {
        if (!item.decoded) continue;
        const replacement = item.isHex
          ? `<${'20'.repeat(Math.max(1, item.decoded.length))}>`
          : `(${' '.repeat(item.decoded.length)})`;
        replacedInner = replacedInner.replace(item.raw, replacement);
      }
      return `[ ${replacedInner} ] TJ`;
    });
  }
  return result;
}

export function scrubPageStreamsAndXObjects(
  page: any,
  words: string[],
  pdfDoc: PDFDocument
): number {
  if (!words || words.length === 0) return 0;
  let scrubbedCount = 0;

  const processStreamRef = (ref: PDFRef) => {
    try {
      const stream = pdfDoc.context.lookup(ref) as any;
      if (stream && (typeof stream.getContents === 'function' || stream.contents)) {
        const rawSource = typeof stream.getContents === 'function' ? stream.getContents() : stream.contents;
        const rawBytes = new Uint8Array(rawSource);
        const filter = stream.dict?.get(PDFName.of('Filter'));
        let streamText = '';
        let isFlate = false;

        if (filter && filter.toString().includes('FlateDecode')) {
          isFlate = true;
          try {
            const inflated = pako.inflate(rawBytes);
            streamText = new TextDecoder('latin1').decode(inflated);
          } catch (inflateErr) {
            console.warn('PDF stream inflate fallback:', inflateErr);
            streamText = new TextDecoder('latin1').decode(rawBytes);
          }
        } else {
          streamText = new TextDecoder('latin1').decode(rawBytes);
        }

        const scrubbed = scrubContentStream(streamText, words);
        if (scrubbed !== streamText) {
          const newStream = isFlate
            ? pdfDoc.context.flateStream(scrubbed)
            : pdfDoc.context.stream(scrubbed);

          if (stream.dict) {
            const entries = stream.dict.entries();
            for (const [k, v] of entries) {
              if (k.toString() !== '/Length' && k.toString() !== '/Filter') {
                newStream.dict.set(k, v);
              }
            }
          }
          pdfDoc.context.assign(ref, newStream);
          scrubbedCount++;
        }
      }
    } catch (streamErr) {
      console.warn('PDF stream scrub error:', streamErr);
    }
  };

  try {
    const contentsObj = page.node.Contents();
    if (contentsObj) {
      if (contentsObj instanceof PDFRef) {
        processStreamRef(contentsObj);
      } else if ((contentsObj as any).asArray) {
        for (const item of (contentsObj as any).asArray()) {
          if (item instanceof PDFRef) processStreamRef(item);
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    const resources = page.node.Resources();
    if (resources) {
      const xobjDict = resources.lookup(PDFName.of('XObject'));
      if (xobjDict && (xobjDict as any).dict) {
        for (const key of (xobjDict as any).dict.keys()) {
          const xobjRef = (xobjDict as any).dict.get(key);
          if (xobjRef instanceof PDFRef) {
            const xobj = pdfDoc.context.lookup(xobjRef) as any;
            const subtype = xobj?.dict?.get(PDFName.of('Subtype'));
            if (subtype && subtype.toString().includes('Form')) {
              processStreamRef(xobjRef);
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return scrubbedCount;
}

/**
 * Search for matching terms across PDF pages and permanently redact every match.
 */
export async function searchAndRedactPdf(
  pdfData: ArrayBuffer | Uint8Array,
  terms: string[]
): Promise<SanitizedPdfResult> {
  const cleanTerms = Array.from(new Set(terms.map((t) => t.trim()).filter((t) => t.length > 0)));
  if (cleanTerms.length === 0) {
    throw new Error('Provide at least one search term or coordinate region to redact.');
  }

  const safeData = toSafeUint8Array(pdfData);
  const targets: RedactionTarget[] = [];
  const doc = await pdfjsLib.getDocument({ data: safeData.slice() }).promise;

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();

      let pageHadTerm = false;
      for (const item of textContent.items as any[]) {
        const str = typeof item?.str === 'string' ? item.str : '';
        if (!str.trim()) continue;
        const lowerStr = str.toLowerCase();
        for (const term of cleanTerms) {
          if (lowerStr.includes(term.toLowerCase())) {
            pageHadTerm = true;
            const tx = Array.isArray(item.transform) ? Number(item.transform[4] || 48) : 48;
            const ty = Array.isArray(item.transform) ? Number(item.transform[5] || 48) : 48;
            const tw = Math.max(40, Number(item.width || term.length * 7));
            const th = Math.max(14, Number(item.height || 14));
            targets.push({
              pageNumber: pageNum,
              x: tx,
              y: Math.min(Math.max(0, ty), viewport.height - th),
              width: tw,
              height: th,
              textToRedact: term,
              reason: `Search redact: "${term}"`,
            });
          }
        }
      }

      if (!pageHadTerm) {
        // Still apply stream scrub attempt on page 1 if term wasn't isolated to one item
        if (pageNum === 1) {
          for (const term of cleanTerms) {
            targets.push({
              pageNumber: 1,
              x: 36,
              y: 36,
              width: 120,
              height: 16,
              textToRedact: term,
              reason: `Stream scrub: "${term}"`,
            });
          }
        }
      }
    }
  } finally {
    try {
      await doc.cleanup?.();
      await (doc as any).destroy?.();
    } catch {
      // ignore
    }
  }

  return sanitizeAndRedactPdf(safeData, targets);
}

/**
 * Permanently sanitize metadata, scrub PDF content/XObject streams, draw opaque blackouts,
 * and verify post-save stream & PDF.js text absence.
 */
export async function sanitizeAndRedactPdf(
  pdfData: ArrayBuffer | Uint8Array,
  redactions: RedactionTarget[]
): Promise<SanitizedPdfResult> {
  const safeData = toSafeUint8Array(pdfData);
  const pdfDoc = await PDFDocument.load(safeData, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  // Step 1: Strip document metadata & XMP streams
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('OmniDoc Mobile Verified Sanitizer');
  pdfDoc.setCreator('OmniDoc Mobile Sanitizer');

  try {
    pdfDoc.catalog.delete(PDFName.of('Metadata'));
    pdfDoc.catalog.delete(PDFName.of('PieceInfo'));
  } catch {
    // ignore
  }

  let redactionsApplied = 0;
  let annotationsRemoved = 0;
  let coordinateTargetsResolved = 0;
  let unresolvedCoordinateTargets = 0;
  let imagesDetectedOnRedactedPages = false;
  const checksPerformed: string[] = [];

  const resolvedWordsByPage = new Map<number, string[]>();
  const coordinateOnlyTargets = redactions.filter((r) => !r.textToRedact || r.textToRedact.trim().length === 0);
  if (coordinateOnlyTargets.length > 0) {
    checksPerformed.push('coordinate_text_discovery');
    let preScanDoc: any = null;
    try {
      preScanDoc = await pdfjsLib.getDocument({ data: safeData.slice() }).promise;
      for (const target of coordinateOnlyTargets) {
        if (target.pageNumber < 1 || target.pageNumber > preScanDoc.numPages) {
          unresolvedCoordinateTargets++;
          continue;
        }
        const jsPage = await preScanDoc.getPage(target.pageNumber);
        const viewport = jsPage.getViewport({ scale: 1 });
        const textContent = await jsPage.getTextContent();
        const boxLeft = Math.max(0, target.x);
        const boxRight = boxLeft + Math.max(1, target.width);
        const pdfY =
          target.y < 0 || target.y > viewport.height
            ? Math.max(0, viewport.height - target.y - target.height)
            : target.y;
        const boxBottom = Math.max(0, pdfY);
        const boxTop = boxBottom + Math.max(1, target.height);

        const matchedStrings: string[] = [];
        for (const item of textContent.items as any[]) {
          if (!item || typeof item.str !== 'string' || item.str.trim().length < 2) continue;
          const ix = Array.isArray(item.transform) ? Number(item.transform[4] || 0) : 0;
          const iy = Array.isArray(item.transform) ? Number(item.transform[5] || 0) : 0;
          const iw = Number(item.width || item.str.length * 5);
          const ih = Number(item.height || 12);
          if (ix <= boxRight && ix + iw >= boxLeft && iy <= boxTop && iy + ih >= boxBottom) {
            matchedStrings.push(item.str.trim());
          }
        }

        if (matchedStrings.length > 0) {
          coordinateTargetsResolved++;
          const prev = resolvedWordsByPage.get(target.pageNumber) || [];
          resolvedWordsByPage.set(target.pageNumber, [...prev, ...matchedStrings]);
        } else {
          unresolvedCoordinateTargets++;
        }
      }
    } catch {
      unresolvedCoordinateTargets += coordinateOnlyTargets.length;
    } finally {
      try {
        await preScanDoc?.cleanup?.();
        await preScanDoc?.destroy?.();
      } catch {
        // ignore
      }
    }
  }

  const targetWordsToVerify: Array<{ page: number; word: string }> = redactions
    .filter((r) => r.textToRedact && r.textToRedact.trim().length > 1)
    .map((r) => ({ page: r.pageNumber, word: r.textToRedact!.trim().toLowerCase() }));

  for (const [pageNum, words] of resolvedWordsByPage.entries()) {
    for (const w of words) {
      if (w.length > 1) {
        targetWordsToVerify.push({ page: pageNum, word: w.toLowerCase() });
      }
    }
  }

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageNum = pageIdx + 1;
    const pageRedactions = redactions.filter((r) => r.pageNumber === pageNum);
    const page = pdfDoc.getPage(pageIdx);
    const { height } = page.getSize();

    try {
      page.node.delete(PDFName.of('PieceInfo'));
      page.node.delete(PDFName.of('Metadata'));
    } catch {
      // ignore
    }

    if (pageRedactions.length > 0) {
      try {
        const resources = page.node.Resources();
        const xobjDict = resources?.lookup(PDFName.of('XObject')) as any;
        if (xobjDict && xobjDict.dict) {
          for (const key of xobjDict.dict.keys()) {
            const xobjRef = xobjDict.dict.get(key);
            const xobj = xobjRef instanceof PDFRef ? (pdfDoc.context.lookup(xobjRef) as any) : null;
            const subtype = xobj?.dict?.get(PDFName.of('Subtype'));
            if (subtype && subtype.toString().includes('Image')) {
              imagesDetectedOnRedactedPages = true;
            }
          }
        }
      } catch {
        // ignore
      }
    }

    const explicitWords = pageRedactions
      .map((r) => r.textToRedact?.trim())
      .filter((w): w is string => Boolean(w && w.length > 0));
    const wordsToScrubOnPage = Array.from(
      new Set([...explicitWords, ...(resolvedWordsByPage.get(pageNum) || [])])
    );

    if (wordsToScrubOnPage.length > 0) {
      scrubPageStreamsAndXObjects(page, wordsToScrubOnPage, pdfDoc);
    }

    if (pageRedactions.length > 0) {
      try {
        const existingAnnots = page.node.get(PDFName.of('Annots'));
        if (existingAnnots) {
          const arr = (existingAnnots as any).asArray ? (existingAnnots as any).asArray() : [];
          annotationsRemoved += Math.max(1, arr.length);
          page.node.delete(PDFName.of('Annots'));
        }
      } catch {
        // ignore
      }
    }

    for (const r of pageRedactions) {
      const pdfY = r.y < 0 || r.y > height ? Math.max(0, height - r.y - r.height) : r.y;
      page.drawRectangle({
        x: Math.max(0, r.x),
        y: Math.max(0, pdfY),
        width: Math.max(1, r.width),
        height: Math.max(1, r.height),
        color: rgb(0, 0, 0),
        opacity: 1.0,
      });
      redactionsApplied++;
    }
  }

  const sanitizedBytes = await pdfDoc.save({ useObjectStreams: false });
  const pdfBlob = new Blob([sanitizedBytes.buffer as ArrayBuffer], { type: 'application/pdf' });

  const residualMatches: string[] = [];
  let verificationError: string | undefined;
  let actualMetadataCleared = false;
  let embeddedFilesDetected = 0;
  let acroFormDetected = false;

  try {
    const reloadedDoc = await PDFDocument.load(sanitizedBytes, { ignoreEncryption: true });
    checksPerformed.push('metadata_inspection');
    const titleEmpty = !reloadedDoc.getTitle();
    const authorEmpty = !reloadedDoc.getAuthor();
    const subjectEmpty = !reloadedDoc.getSubject();
    const keywordsVal = reloadedDoc.getKeywords();
    const keywordsEmpty = !keywordsVal || keywordsVal.trim() === '';
    const hasCatalogMeta = Boolean(reloadedDoc.catalog.get(PDFName.of('Metadata')));
    const hasPieceInfo = Boolean(reloadedDoc.catalog.get(PDFName.of('PieceInfo')));
    actualMetadataCleared =
      titleEmpty && authorEmpty && subjectEmpty && keywordsEmpty && !hasCatalogMeta && !hasPieceInfo;

    checksPerformed.push('attachments_and_forms_inspection');
    const namesDict = reloadedDoc.catalog.lookup(PDFName.of('Names')) as any;
    const embeddedFiles = namesDict?.lookup?.(PDFName.of('EmbeddedFiles'));
    const afEntry = reloadedDoc.catalog.get(PDFName.of('AF'));
    if (embeddedFiles || afEntry) {
      embeddedFilesDetected = 1;
    }
    acroFormDetected = Boolean(reloadedDoc.catalog.get(PDFName.of('AcroForm')));
  } catch (err: any) {
    verificationError = err?.message || String(err);
  }

  checksPerformed.push('binary_stream_scan');
  const latin1Text = new TextDecoder('latin1').decode(sanitizedBytes).toLowerCase();
  for (const { page, word } of targetWordsToVerify) {
    const hex = stringToHex(word).toLowerCase();
    if (latin1Text.includes(word) || latin1Text.includes(hex)) {
      residualMatches.push(`Page ${page}: Residual binary stream match for "${word}"`);
    }
  }

  checksPerformed.push('pdfjs_text_extraction');
  let verifyDoc: any = null;
  try {
    verifyDoc = await pdfjsLib.getDocument({ data: sanitizedBytes.slice() }).promise;
    for (let p = 1; p <= verifyDoc.numPages; p++) {
      const page = await verifyDoc.getPage(p);
      const textContent = await page.getTextContent();
      const extractedText = textContent.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ')
        .toLowerCase();

      for (const { page: targetPage, word } of targetWordsToVerify) {
        if ((targetPage === p || targetPage > verifyDoc.numPages) && extractedText.includes(word)) {
          const matchMsg = `Page ${p}: Found residual extracted text "${word}"`;
          if (!residualMatches.includes(matchMsg)) {
            residualMatches.push(matchMsg);
          }
        }
      }
    }
  } catch (err: any) {
    verificationError = err?.message || String(err);
  } finally {
    try {
      await verifyDoc?.cleanup?.();
      await verifyDoc?.destroy?.();
    } catch {
      // ignore
    }
  }

  let status: RedactionVerificationStatus = 'Verified';
  if (residualMatches.length > 0 || !actualMetadataCleared) {
    status = 'Failed';
  } else if (verificationError) {
    status = 'Incomplete verification';
  } else if (unresolvedCoordinateTargets > 0 && imagesDetectedOnRedactedPages) {
    status = 'Unsupported content detected';
  } else if (unresolvedCoordinateTargets > 0 || (redactions.length > 0 && targetWordsToVerify.length === 0)) {
    status = 'Incomplete verification';
  } else if (embeddedFilesDetected > 0) {
    status = 'Unsupported content detected';
  }

  return {
    pdfBlob,
    pdfBytes: sanitizedBytes,
    report: {
      status,
      isSanitized: status === 'Verified',
      totalPagesSanitized: totalPages,
      redactionsApplied,
      residualTextFound: residualMatches.length > 0,
      residualMatches,
      metadataCleared: actualMetadataCleared,
      annotationsRemoved,
      embeddedFilesDetected,
      acroFormDetected,
      imagesDetectedOnRedactedPages,
      coordinateTargetsResolved,
      unresolvedCoordinateTargets,
      checksPerformed,
      verificationError,
      timestamp: new Date().toISOString(),
    },
  };
}
