import JSZip from 'jszip';
import { FileFormat } from '../types';
import { validateFileFormat } from './formatDetector';

export interface DetailedValidationResult {
  valid: boolean;
  format: FileFormat | null;
  error?: string;
  isEncrypted?: boolean;
  warnings?: string[];
  metadata?: {
    pageCount?: number;
    sheetCount?: number;
    slideCount?: number;
    wordCount?: number;
  };
}

export async function validateUploadFile(
  file: File,
  maxBytes?: number
): Promise<DetailedValidationResult> {
  if (maxBytes && file.size > maxBytes) {
    return {
      valid: false,
      format: null,
      error: `File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed limit (${(maxBytes / (1024 * 1024)).toFixed(0)} MB).`,
    };
  }
  return validateDocumentStructure(file);
}

export async function validateDocumentStructure(file: File): Promise<DetailedValidationResult> {
  const baseResult = await validateFileFormat(file);
  if (!baseResult.valid || !baseResult.format) {
    return {
      valid: false,
      format: null,
      error: baseResult.error || `File "${file.name}" has an unrecognized or unsupported format.`,
    };
  }

  const format = baseResult.format;

  try {
    if (format === 'docx' || format === 'pptx' || format === 'xlsx') {
      return await validateOpenXmlPackage(file, format);
    }
    if (format === 'pdf') {
      return await validatePdfStructure(file);
    }
    if (format === 'txt' || format === 'md' || format === 'html' || format === 'csv') {
      return await validateTextDocument(file, format);
    }
    return { valid: true, format };
  } catch (err: any) {
    return {
      valid: false,
      format,
      error: `Document "${file.name}" is corrupted or cannot be safely parsed: ${err?.message || 'Invalid structure'}`,
    };
  }
}

async function readFileBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return await blob.arrayBuffer();
  }
  return await new Response(blob).arrayBuffer();
}

async function validateOpenXmlPackage(file: File, format: FileFormat): Promise<DetailedValidationResult> {
  let zip: JSZip;
  try {
    const arrayBuffer = await readFileBytes(file);
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    return {
      valid: false,
      format,
      error: `File "${file.name}" is not a valid ZIP archive. The file may be truncated or corrupted.`,
    };
  }

  const isEncrypted = Boolean(zip.file('EncryptedPackage') || zip.file('EncryptionInfo'));
  if (isEncrypted) {
    return {
      valid: false,
      format,
      isEncrypted: true,
      error: `File "${file.name}" is password-protected or encrypted. Remove encryption before uploading.`,
    };
  }

  if (!zip.file('[Content_Types].xml')) {
    return {
      valid: false,
      format,
      error: `Malformed OpenXML package: missing "[Content_Types].xml".`,
    };
  }

  if (format === 'docx' && !zip.file('word/document.xml')) {
    return { valid: false, format, error: `Invalid DOCX: missing "word/document.xml".` };
  }
  if (format === 'pptx' && !zip.file('ppt/presentation.xml')) {
    return { valid: false, format, error: `Invalid PPTX: missing "ppt/presentation.xml".` };
  }
  if (format === 'xlsx' && !zip.file('xl/workbook.xml')) {
    return { valid: false, format, error: `Invalid XLSX: missing "xl/workbook.xml".` };
  }

  return { valid: true, format };
}

async function validatePdfStructure(file: File): Promise<DetailedValidationResult> {
  const buffer = await readFileBytes(file);
  const text = new TextDecoder('latin1').decode(buffer);

  if (text.includes('/Encrypt')) {
    return {
      valid: false,
      format: 'pdf',
      isEncrypted: true,
      error: `PDF "${file.name}" is password-protected (/Encrypt detected). Unlock it before uploading.`,
    };
  }

  if (!text.includes('/Root') && !text.includes('trailer') && !text.includes('%%EOF')) {
    return {
      valid: false,
      format: 'pdf',
      error: `PDF "${file.name}" is truncated or lacks a valid PDF trailer.`,
    };
  }

  return { valid: true, format: 'pdf' };
}

async function validateTextDocument(file: File, format: FileFormat): Promise<DetailedValidationResult> {
  const buffer = await readFileBytes(file.slice(0, 4096));
  const bytes = new Uint8Array(buffer);
  let nullCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) nullCount++;
  }
  if (nullCount > 2) {
    return {
      valid: false,
      format,
      error: `File "${file.name}" contains binary null bytes and is not valid plain text.`,
    };
  }
  return { valid: true, format };
}
