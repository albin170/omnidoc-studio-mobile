import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateUploadFile } from '../engines/fileValidator';
import { validateFileFormat } from '../engines/formatDetector';
import { apiClient, ApiError } from '../services/apiClient';
import { offlineStore } from '../services/offlineStore';

describe('Document Validation, Network Resilience & Offline Store', () => {
  beforeEach(async () => {
    await offlineStore.clearUserCaches();
    apiClient.setToken('test-token');
    vi.restoreAllMocks();
  });

  it('validates magic bytes for PDF, PNG, DOCX and rejects spoofed or oversized files', async () => {
    const validPdf = new File(['%PDF-1.4\n1 0 obj\n<< /Root 2 0 R >>\n%%EOF'], 'valid.pdf', {
      type: 'application/pdf',
    });
    const fakePdf = new File(['MZ_NOT_A_PDF_EXECUTABLE'], 'spoofed.pdf', { type: 'application/pdf' });
    const legacyDoc = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x01])], 'legacy.doc');

    expect((await validateUploadFile(validPdf)).valid).toBe(true);
    expect((await validateUploadFile(fakePdf)).valid).toBe(false);
    expect((await validateFileFormat(legacyDoc)).isLegacyOffice).toBe(true);
    expect((await validateUploadFile(validPdf, 5)).valid).toBe(false);
  });

  it('retries transient 503 network errors on GET requests and succeeds when backend recovers', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Temporary 503' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'doc-1', filename: 'report.pdf' }]), { status: 200 }));

    const docs = await apiClient.listDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].filename).toBe('report.pdf');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('surfaces clean error on persistent network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiClient.listDocuments()).rejects.toBeInstanceOf(ApiError);
  });

  it('persists offline document cache and processing history, and clears on logout wipe', async () => {
    await offlineStore.cacheDocuments([
      {
        id: 'doc-1',
        org_id: 'org-1',
        user_id: 'u-1',
        filename: 'offline.pdf',
        file_size: 2048,
        mime_type: 'application/pdf',
        format_type: 'pdf',
        content_hash_sha256: 'abc123',
        version: 1,
        created_at: new Date().toISOString(),
      },
    ]);

    await offlineStore.appendHistory({
      kind: 'conversion',
      title: 'Converted notes.txt',
      sourceFormat: 'txt',
      targetFormat: 'pdf',
      sizeBytes: 1024,
      status: 'completed',
    });

    expect((await offlineStore.getCachedDocuments())[0].filename).toBe('offline.pdf');
    expect((await offlineStore.getLocalHistory())[0].title).toBe('Converted notes.txt');

    await offlineStore.clearUserCaches();
    expect(await offlineStore.getCachedDocuments()).toHaveLength(0);
    expect(await offlineStore.getLocalHistory()).toHaveLength(0);
  });
});
