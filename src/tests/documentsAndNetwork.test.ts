import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateUploadFile } from '../engines/fileValidator';
import { validateFileFormat } from '../engines/formatDetector';
import { apiClient, ApiError } from '../services/apiClient';
import { offlineStore } from '../services/offlineStore';
import { secureStorage } from '../services/secureStorage';

describe('Document Validation, Streaming Downloads, Network Resilience & Offline Store', () => {
  beforeEach(async () => {
    await offlineStore.clearUserCaches();
    await secureStorage.clearAll();
    apiClient.setToken('test-token');
    apiClient.setSessionExpiredHandler(null);
    vi.restoreAllMocks();
  });

  it('validates magic bytes for PDF, PNG, JPEG, WebP, DOCX and rejects spoofed, encrypted, legacy, or oversized files', async () => {
    const validPdf = new File(['%PDF-1.4\n1 0 obj\n<< /Root 2 0 R >>\n%%EOF'], 'valid.pdf', {
      type: 'application/pdf',
    });
    const encryptedPdf = new File(['%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\n%%EOF'], 'locked.pdf', {
      type: 'application/pdf',
    });
    const fakePdf = new File(['MZ_NOT_A_PDF_EXECUTABLE'], 'spoofed.pdf', { type: 'application/pdf' });
    const validPng = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'pic.png', {
      type: 'image/png',
    });
    const validJpg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    const validWebp = new File(
      [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])],
      'img.webp',
      { type: 'image/webp' }
    );
    const spoofedDocx = new File(['plain text pretending to be docx'], 'fake.docx');
    const legacyDoc = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x01])], 'legacy.doc');

    expect((await validateUploadFile(validPdf)).valid).toBe(true);
    expect((await validateUploadFile(encryptedPdf)).isEncrypted).toBe(true);
    expect((await validateUploadFile(encryptedPdf)).valid).toBe(false);
    expect((await validateUploadFile(fakePdf)).valid).toBe(false);
    expect((await validateUploadFile(validPng)).valid).toBe(true);
    expect((await validateUploadFile(validJpg)).valid).toBe(true);
    expect((await validateUploadFile(validWebp)).valid).toBe(true);
    expect((await validateUploadFile(spoofedDocx)).valid).toBe(false);
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

  it('streams document downloads with Content-Length progress updates and accurate byte reassembly', async () => {
    const chunk1 = new Uint8Array([1, 2, 3, 4]);
    const chunk2 = new Uint8Array([5, 6, 7, 8]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': '8',
        },
      })
    );

    const progressEvents: number[] = [];
    const blob = await apiClient.downloadDocument('doc-stream-1', (pct) => progressEvents.push(pct));
    expect(progressEvents).toEqual([50, 99, 100]);
    expect(blob.type).toBe('application/pdf');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('aborts document downloads cleanly via AbortSignal and handles 401 session expiration', async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(apiClient.downloadDocument('doc-1', undefined, preAborted.signal)).rejects.toThrow(
      /cancelled/i
    );

    const midController = new AbortController();
    const cancelableStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(cancelableStream, { status: 200, headers: { 'content-length': '100' } })
    );

    const progressUpdates: number[] = [];
    await expect(
      apiClient.downloadDocument(
        'doc-2',
        (pct) => {
          progressUpdates.push(pct);
          midController.abort();
        },
        midController.signal
      )
    ).rejects.toThrow(/cancelled/i);
    expect(progressUpdates).toEqual([3]);

    const onExpired = vi.fn();
    apiClient.setSessionExpiredHandler(onExpired);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(apiClient.downloadDocument('doc-3')).rejects.toBeInstanceOf(ApiError);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(apiClient.getToken()).toBeNull();
  });

  it('isolates offline cache and clears documents, jobs, usage, entitlements, and history on logout', async () => {
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
    await offlineStore.cacheJobs([
      {
        id: 'job-1',
        org_id: 'org-1',
        user_id: 'u-1',
        title: 'Index PDF',
        objective: 'parse',
        status: 'completed',
        mode: 'hybrid',
        current_step_index: 1,
        total_steps: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
    await offlineStore.cacheUsage({
      storage_used_bytes: 2048,
      storage_quota_bytes: 1024 * 1024,
      documents_count: 1,
      jobs_count: 1,
      recent_jobs: [],
    });
    await offlineStore.cacheEntitlements({
      user_id: 'u-1',
      org_id: 'org-1',
      plan_slug: 'free',
      plan_name: 'Free',
      is_active: true,
      is_suspended: false,
      enabled_features: ['pdf_studio'],
      disabled_features: [],
      storage_quota_bytes: 1024 * 1024,
      processing_quota: 50,
      ocr_quota: 10,
      ai_quota: 10,
      workflow_quota: 5,
      max_file_size_bytes: 25 * 1024 * 1024,
      has_api_access: false,
      support_level: 'standard',
    });

    await offlineStore.appendHistory({
      kind: 'conversion',
      title: 'Converted notes.txt',
      sourceFormat: 'txt',
      targetFormat: 'pdf',
      sizeBytes: 1024,
      status: 'completed',
    });

    expect((await offlineStore.getCachedDocuments())[0].filename).toBe('offline.pdf');
    expect((await offlineStore.getCachedJobs())[0].id).toBe('job-1');
    expect((await offlineStore.getCachedUsage())?.documents_count).toBe(1);
    expect((await offlineStore.getCachedEntitlements())?.plan_slug).toBe('free');
    expect((await offlineStore.getLocalHistory())[0].title).toBe('Converted notes.txt');
    expect(await offlineStore.getLastSyncTimestamp()).not.toBeNull();

    await offlineStore.clearUserCaches();
    expect(await offlineStore.getCachedDocuments()).toHaveLength(0);
    expect(await offlineStore.getCachedJobs()).toHaveLength(0);
    expect(await offlineStore.getCachedUsage()).toBeNull();
    expect(await offlineStore.getCachedEntitlements()).toBeNull();
    expect(await offlineStore.getLocalHistory()).toHaveLength(0);
    expect(await offlineStore.getLastSyncTimestamp()).toBeNull();
  });

  it('formats FastAPI/Pydantic 422 validation error arrays into readable ApiError messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: [
            {
              loc: ['body', 'email'],
              msg: 'value is not a valid email address: reserved domain',
              type: 'value_error',
            },
          ],
        }),
        { status: 422 }
      )
    );

    let caught: unknown = null;
    try {
      await apiClient.register({
        email: 'bad@omnidoc.local',
        password: 'Password123!',
        full_name: 'Bad Email User',
        terms_accepted: true,
        privacy_accepted: true,
        ai_consent: true,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(422);
    expect((caught as ApiError).message).toContain('email');
    expect((caught as ApiError).message).toContain('value is not a valid email address: reserved domain');
  });
});
