import { apiClient } from '../services/apiClient';
import { extractTextFromPdf } from './pdfService';

export interface MobileOcrResult {
  text: string;
  source: 'on_device_pdf' | 'cloud_ocr';
  wordsCount: number;
  documentId?: string;
}

/**
 * Extract text using on-device PDF text streams when available, falling back to
 * OmniDoc Cloud OCR tool (`/tools/invoke` `extract_fields` + Digital Twin) for
 * raster images or scanned image-only PDFs. Never fabricates offline OCR for images.
 */
export async function performMobileOcr(
  file: File,
  options: { isOnline: boolean; onProgress?: (stage: string) => void }
): Promise<MobileOcrResult> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    options.onProgress?.('Inspecting PDF text streams on-device...');
    const rawBuffer = await file.arrayBuffer();
    const extracted = await extractTextFromPdf(rawBuffer);
    const cleaned = extracted.replace(/--- Page \d+ ---/g, '').trim();
    if (cleaned.length > 0) {
      const wordsCount = cleaned.split(/\s+/).filter(Boolean).length;
      return {
        text: extracted,
        source: 'on_device_pdf',
        wordsCount,
      };
    }
    if (!options.isOnline) {
      throw new Error(
        'Scanned image-only PDF has no selectable text stream. Connect to OmniDoc Cloud to run backend OCR.'
      );
    }
  }

  if (!options.isOnline) {
    throw new Error(
      'On-device raster OCR is not bundled offline. Connect to OmniDoc Cloud to extract text from images.'
    );
  }

  options.onProgress?.('Uploading source file to OmniDoc Vault...');
  const uploaded = await apiClient.uploadDocument(file);

  options.onProgress?.('Running Cloud OCR extraction...');
  let extractedText = '';
  try {
    const toolRes = await apiClient.invokeTool('extract_fields', { document_id: uploaded.id });
    if (toolRes?.data?.text && typeof toolRes.data.text === 'string') {
      extractedText = toolRes.data.text.trim();
    } else if (toolRes?.data?.extracted_text && typeof toolRes.data.extracted_text === 'string') {
      extractedText = toolRes.data.extracted_text.trim();
    } else if (toolRes?.data && typeof toolRes.data === 'object') {
      extractedText = JSON.stringify(toolRes.data, null, 2);
    }
  } catch {
    // Fallback to Digital Twin indexed summary/text if tool invocation is plan-gated
  }

  if (!extractedText) {
    const fullDoc = await apiClient.getDocument(uploaded.id);
    const twin = fullDoc.digital_twin || {};
    extractedText = String(
      twin.extracted_text_preview || twin.text_preview || twin.content_preview || twin.summary || ''
    ).trim();
  }

  if (!extractedText) {
    throw new Error('Cloud OCR completed, but no selectable text was found in this image.');
  }

  return {
    text: extractedText,
    source: 'cloud_ocr',
    wordsCount: extractedText.split(/\s+/).filter(Boolean).length,
    documentId: uploaded.id,
  };
}
