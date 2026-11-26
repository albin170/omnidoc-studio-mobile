import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Cloud,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  FolderOpen,
  MoreVertical,
  PenTool,
  Presentation,
  RefreshCw,
  Repeat,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { validateUploadFile } from '../engines/fileValidator';
import { formatFileSize } from '../engines/formatDetector';
import { imagesToPdf } from '../engines/pdfService';
import { apiClient } from '../services/apiClient';
import { captureDocumentPhoto, hapticTap, saveFileToDevice, shareDocumentFile } from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';
import { BackendDocument, CloudProjectDetail, CloudProjectSummary } from '../types';

export interface LibraryScreenProps {
  onOpenInPdfStudio: (file: File) => void;
  onOpenInConversionStudio: (file: File) => void;
  onOpenInWordStudio: (file: File) => void;
  onOpenInSlidesStudio: (file: File) => void;
  onOpenInSheetsStudio: (file: File) => void;
  onOpenProjectInWordStudio: (project: CloudProjectDetail) => void;
  onOpenProjectInSlidesStudio: (project: CloudProjectDetail) => void;
  onOpenProjectInSheetsStudio: (project: CloudProjectDetail) => void;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}

type PreviewState =
  | { kind: 'loading'; doc: BackendDocument }
  | { kind: 'image'; doc: BackendDocument; objectUrl: string }
  | { kind: 'text'; doc: BackendDocument; text: string; truncated: boolean }
  | { kind: 'pdf' | 'metadata'; doc: BackendDocument }
  | { kind: 'error'; doc: BackendDocument; error: string };

const TEXT_PREVIEW_FORMATS = new Set(['txt', 'csv', 'md', 'html']);
const IMAGE_PREVIEW_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const WORD_FORMATS = new Set(['docx', 'txt', 'md', 'html']);
const SHEET_FORMATS = new Set(['xlsx', 'csv']);

function renderDigitalTwinSummary(twin: any): React.ReactNode {
  if (!twin || typeof twin !== 'object') {
    return (
      <p className="text-xs text-slate-400">
        No Digital Twin metadata indexed for this document yet.
      </p>
    );
  }

  const summaryText =
    twin.summary || twin.executive_summary || twin.description || twin.abstract || null;
  const docType = twin.document_type || twin.category || twin.classification || null;
  const pageCount = twin.page_count ?? twin.pages ?? null;
  const language = twin.language || null;
  const keywords = Array.isArray(twin.keywords)
    ? twin.keywords
    : Array.isArray(twin.entities)
    ? twin.entities
    : Array.isArray(twin.tags)
    ? twin.tags
    : null;
  const textSnippet =
    twin.extracted_text_preview || twin.text_preview || twin.content_preview || null;

  const extraEntries = Object.entries(twin)
    .filter(
      ([k, v]) =>
        ![
          'summary',
          'executive_summary',
          'description',
          'abstract',
          'document_type',
          'category',
          'classification',
          'page_count',
          'pages',
          'language',
          'keywords',
          'entities',
          'tags',
          'extracted_text_preview',
          'text_preview',
          'content_preview',
        ].includes(k) &&
        (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    )
    .slice(0, 8);

  return (
    <div className="space-y-2.5 text-xs">
      {(docType || pageCount !== null || language) && (
        <div className="grid grid-cols-3 gap-2">
          {docType && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-2">
              <p className="text-[10px] text-slate-500 uppercase">Type</p>
              <p className="font-semibold text-slate-200 truncate">{String(docType)}</p>
            </div>
          )}
          {pageCount !== null && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-2">
              <p className="text-[10px] text-slate-500 uppercase">Pages</p>
              <p className="font-semibold text-slate-200">{String(pageCount)}</p>
            </div>
          )}
          {language && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-2">
              <p className="text-[10px] text-slate-500 uppercase">Language</p>
              <p className="font-semibold text-slate-200 uppercase">{String(language)}</p>
            </div>
          )}
        </div>
      )}

      {summaryText && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
          <p className="text-[10px] font-semibold uppercase text-indigo-300">Digital Twin Summary</p>
          <p className="text-slate-200 leading-relaxed">{String(summaryText)}</p>
        </div>
      )}

      {keywords && keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {keywords.slice(0, 12).map((kw: any, idx: number) => (
            <span
              key={idx}
              className="px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-[10px] text-indigo-200"
            >
              {typeof kw === 'string' ? kw : kw?.name || kw?.text || JSON.stringify(kw)}
            </span>
          ))}
        </div>
      )}

      {textSnippet && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
          <p className="text-[10px] font-semibold uppercase text-slate-400">Extracted Text Preview</p>
          <p className="text-slate-300 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
            {String(textSnippet)}
          </p>
        </div>
      )}

      {extraEntries.length > 0 && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase text-slate-400">Structured Attributes</p>
          <div className="grid grid-cols-2 gap-1.5">
            {extraEntries.map(([k, v]) => (
              <div key={k} className="truncate">
                <span className="text-slate-500">{k}: </span>
                <span className="text-slate-200 font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  onOpenInPdfStudio,
  onOpenInConversionStudio,
  onOpenInWordStudio,
  onOpenInSlidesStudio,
  onOpenInSheetsStudio,
  onOpenProjectInWordStudio,
  onOpenProjectInSlidesStudio,
  onOpenProjectInSheetsStudio,
  onToast,
}) => {
  const { isOnline, entitlements } = useAuth();
  const [section, setSection] = useState<'documents' | 'projects'>('documents');
  const [docs, setDocs] = useState<BackendDocument[]>([]);
  const [projects, setProjects] = useState<CloudProjectSummary[]>([]);
  const [search, setSearch] = useState('');
  const [formatFilter, setFormatFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [downloadState, setDownloadState] = useState<{ filename: string; percent: number } | null>(null);

  const [selectedDoc, setSelectedDoc] = useState<BackendDocument | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteDocTarget, setDeleteDocTarget] = useState<BackendDocument | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<CloudProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);

  const revokePreviewUrl = useCallback(() => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      downloadAbortRef.current?.abort();
      revokePreviewUrl();
    };
  }, [revokePreviewUrl]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const cached = await offlineStore.getCachedDocuments();
      if (cached.length > 0) setDocs(cached);

      if (isOnline) {
        const [liveDocs, liveProjects] = await Promise.all([
          apiClient.listDocuments(),
          apiClient.listProjects().catch(() => []),
        ]);
        setDocs(liveDocs);
        setProjects(liveProjects);
        await offlineStore.cacheDocuments(liveDocs);
      }
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to sync library');
    } finally {
      setLoading(false);
    }
  }, [isOnline, onToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUploadFile = async (file: File) => {
    if (!isOnline) {
      onToast('error', 'Upload requires an internet connection.');
      return;
    }
    const maxBytes = entitlements?.max_file_size_bytes || 50 * 1024 * 1024;
    const validation = await validateUploadFile(file, maxBytes);
    if (!validation.valid) {
      onToast('error', validation.error || 'File failed security validation.');
      return;
    }

    setUploadPct(1);
    try {
      const uploaded = await apiClient.uploadDocument(file, (pct) => setUploadPct(pct));
      await hapticTap('medium');
      await offlineStore.appendHistory({
        kind: 'upload',
        title: `Uploaded ${uploaded.filename}`,
        sourceFormat: uploaded.format_type,
        targetFormat: uploaded.format_type,
        sizeBytes: uploaded.file_size,
        status: 'completed',
        documentId: uploaded.id,
      });
      onToast('success', `Uploaded "${uploaded.filename}" to shared vault.`);
      await refresh();
    } catch (err: any) {
      onToast('error', err?.message || 'Upload failed');
    } finally {
      setUploadPct(null);
    }
  };

  const handleCameraUpload = async () => {
    try {
      const photo = await captureDocumentPhoto('camera');
      const pdfBytes = await imagesToPdf([{ bytes: photo.bytes, mimeType: photo.mimeType }]);
      const pdfFile = new File([pdfBytes as any], `scan_${Date.now()}.pdf`, { type: 'application/pdf' });
      await handleUploadFile(pdfFile);
    } catch (err: any) {
      if (!String(err?.message || '').toLowerCase().includes('cancel')) {
        onToast('error', err?.message || 'Camera scan failed');
      }
    }
  };

  const downloadWithProgress = async (doc: BackendDocument): Promise<Blob> => {
    downloadAbortRef.current?.abort();
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setDownloadState({ filename: doc.filename, percent: 0 });
    try {
      const blob = await apiClient.downloadDocument(
        doc.id,
        (pct) => setDownloadState({ filename: doc.filename, percent: pct }),
        controller.signal
      );
      return blob;
    } finally {
      if (downloadAbortRef.current === controller) {
        downloadAbortRef.current = null;
      }
      setDownloadState(null);
    }
  };

  const downloadAsFile = async (doc: BackendDocument): Promise<File> => {
    const blob = await downloadWithProgress(doc);
    return new File([blob], doc.filename, { type: doc.mime_type || 'application/octet-stream' });
  };

  const closePreview = () => {
    downloadAbortRef.current?.abort();
    revokePreviewUrl();
    setPreview(null);
  };

  const openPreview = async (doc: BackendDocument) => {
    setSelectedDoc(null);
    revokePreviewUrl();
    const fmt = doc.format_type.toLowerCase();

    if (IMAGE_PREVIEW_FORMATS.has(fmt)) {
      setPreview({ kind: 'loading', doc });
      try {
        const blob = await downloadWithProgress(doc);
        const objectUrl = URL.createObjectURL(blob);
        previewObjectUrlRef.current = objectUrl;
        setPreview({ kind: 'image', doc, objectUrl });
      } catch (err: any) {
        if (err?.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('cancel')) {
          setPreview(null);
          return;
        }
        setPreview({ kind: 'error', doc, error: err?.message || 'Image preview failed' });
      }
      return;
    }

    if (TEXT_PREVIEW_FORMATS.has(fmt)) {
      setPreview({ kind: 'loading', doc });
      try {
        const blob = await downloadWithProgress(doc);
        const raw = await blob.text();
        const maxChars = 120000;
        setPreview({
          kind: 'text',
          doc,
          text: raw.length > maxChars ? raw.slice(0, maxChars) : raw,
          truncated: raw.length > maxChars,
        });
      } catch (err: any) {
        if (err?.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('cancel')) {
          setPreview(null);
          return;
        }
        setPreview({ kind: 'error', doc, error: err?.message || 'Text preview failed' });
      }
      return;
    }

    // PDF and Office metadata + Digital Twin summary
    setPreview({ kind: fmt === 'pdf' ? 'pdf' : 'metadata', doc });
    if (isOnline && !doc.digital_twin) {
      try {
        const fullDoc = await apiClient.getDocument(doc.id);
        setPreview((prev) =>
          prev && prev.doc.id === doc.id ? { kind: fmt === 'pdf' ? 'pdf' : 'metadata', doc: fullDoc } : prev
        );
      } catch {
        // Keep base doc metadata if digital_twin fetch fails
      }
    }
  };

  const handleDocAction = async (
    action: 'preview' | 'download' | 'share' | 'pdf' | 'word' | 'slides' | 'sheets' | 'convert' | 'rag' | 'delete'
  ) => {
    if (!selectedDoc) return;
    const doc = selectedDoc;
    if (action === 'preview') {
      await openPreview(doc);
      return;
    }
    if (action === 'delete') {
      setDeleteDocTarget(doc);
      return;
    }

    setBusyAction(true);
    try {
      if (action === 'download') {
        const blob = await downloadWithProgress(doc);
        const saved = await saveFileToDevice(blob, doc.filename);
        await hapticTap('light');
        onToast('success', `Saved to ${saved.path}`);
      } else if (action === 'share') {
        const blob = await downloadWithProgress(doc);
        await shareDocumentFile(blob, doc.filename, doc.filename);
      } else if (action === 'pdf') {
        const f = await downloadAsFile(doc);
        setSelectedDoc(null);
        onOpenInPdfStudio(f);
      } else if (action === 'word') {
        const f = await downloadAsFile(doc);
        setSelectedDoc(null);
        onOpenInWordStudio(f);
      } else if (action === 'slides') {
        const f = await downloadAsFile(doc);
        setSelectedDoc(null);
        onOpenInSlidesStudio(f);
      } else if (action === 'sheets') {
        const f = await downloadAsFile(doc);
        setSelectedDoc(null);
        onOpenInSheetsStudio(f);
      } else if (action === 'convert') {
        const f = await downloadAsFile(doc);
        setSelectedDoc(null);
        onOpenInConversionStudio(f);
      } else if (action === 'rag') {
        const res = await apiClient.indexDocumentRag(doc.id);
        onToast('success', `Indexed ${res.chunks_indexed} chunks for AI Q&A.`);
      }
    } catch (err: any) {
      if (!String(err?.message || '').toLowerCase().includes('cancel')) {
        onToast('error', err?.message || 'Action failed');
      }
    } finally {
      setBusyAction(false);
    }
  };

  const handleOpenProject = async (proj: CloudProjectSummary) => {
    if (!isOnline) {
      onToast('error', 'Loading cloud projects requires connectivity.');
      return;
    }
    setBusyAction(true);
    try {
      const detail = await apiClient.getProject(proj.id);
      if (proj.project_type === 'docx') {
        onOpenProjectInWordStudio(detail);
      } else if (proj.project_type === 'slides') {
        onOpenProjectInSlidesStudio(detail);
      } else if (proj.project_type === 'sheets') {
        onOpenProjectInSheetsStudio(detail);
      } else {
        onToast('info', `Project "${proj.title}" (${proj.project_type}) synced.`);
      }
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to open cloud project');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveRename = async (proj: CloudProjectSummary) => {
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === proj.title) {
      setRenamingProjectId(null);
      return;
    }
    try {
      const updated = await apiClient.renameProject(proj.id, trimmed, proj.version);
      setProjects((prev) => prev.map((p) => (p.id === proj.id ? updated : p)));
      setRenamingProjectId(null);
      onToast('success', `Renamed project to "${updated.title}".`);
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to rename project');
    }
  };

  const handleConfirmDeleteDoc = async () => {
    if (!deleteDocTarget) return;
    setDeleting(true);
    try {
      await apiClient.deleteDocument(deleteDocTarget.id);
      onToast('success', `Deleted "${deleteDocTarget.filename}".`);
      if (selectedDoc?.id === deleteDocTarget.id) setSelectedDoc(null);
      setDeleteDocTarget(null);
      await refresh();
    } catch (err: any) {
      onToast('error', err?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmDeleteProject = async () => {
    if (!deleteProjectTarget) return;
    setDeleting(true);
    try {
      await apiClient.deleteProject(deleteProjectTarget.id);
      onToast('success', `Deleted project "${deleteProjectTarget.title}".`);
      setDeleteProjectTarget(null);
      await refresh();
    } catch (err: any) {
      onToast('error', err?.message || 'Project delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const filteredDocs = docs.filter((d) => {
    const matchesQuery = d.filename.toLowerCase().includes(search.toLowerCase());
    const matchesFormat = formatFilter === 'all' || d.format_type.toLowerCase() === formatFilter;
    return matchesQuery && matchesFormat;
  });

  const filteredProjects = projects.filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  const selectedFmt = selectedDoc?.format_type.toLowerCase() || '';

  return (
    <div className="space-y-3.5 pb-6">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.docx,.xlsx,.pptx,.csv,.png,.jpg,.jpeg,.webp,.txt,.md,.html"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUploadFile(f);
          e.target.value = '';
        }}
      />

      {/* Action Bar */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadPct !== null}
          className="flex-1 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 active:bg-indigo-700 disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          Upload Document
        </button>
        <button
          type="button"
          onClick={handleCameraUpload}
          disabled={uploadPct !== null}
          className="h-11 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-semibold flex items-center gap-1.5 active:bg-slate-800"
        >
          <Camera className="w-4 h-4 text-cyan-400" />
          Scan
        </button>
        <button
          type="button"
          onClick={refresh}
          className="w-11 h-11 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300"
          aria-label="Sync library"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Upload Progress */}
      {uploadPct !== null && (
        <div className="bg-slate-900 border border-indigo-500/30 rounded-xl p-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-indigo-300 font-medium">Uploading to OmniDoc Vault...</span>
            <span>{uploadPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
        </div>
      )}

      {/* Streaming Download Progress */}
      {downloadState && (
        <div className="bg-slate-900 border border-cyan-500/35 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-cyan-300 font-medium truncate">
              Downloading {downloadState.filename}…
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-slate-200">{downloadState.percent}%</span>
              <button
                type="button"
                onClick={() => downloadAbortRef.current?.abort()}
                className="text-rose-400 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-cyan-500 transition-all"
              style={{ width: `${downloadState.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Documents vs Cloud Projects Switcher */}
      <div className="grid grid-cols-2 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
        <button
          type="button"
          onClick={() => setSection('documents')}
          className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 ${
            section === 'documents' ? 'bg-indigo-600 text-white' : 'text-slate-400'
          }`}
        >
          <Cloud className="w-3.5 h-3.5" /> Vault Files ({docs.length})
        </button>
        <button
          type="button"
          onClick={() => setSection('projects')}
          className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 ${
            section === 'projects' ? 'bg-indigo-600 text-white' : 'text-slate-400'
          }`}
        >
          <FolderKanban className="w-3.5 h-3.5" /> Cloud Projects ({projects.length})
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
        <label htmlFor="library-search" className="sr-only">
          Search documents and projects
        </label>
        <input
          id="library-search"
          name="librarySearch"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={section === 'documents' ? 'Search vault documents...' : 'Search cloud projects...'}
          className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {section === 'documents' ? (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {['all', 'pdf', 'docx', 'pptx', 'xlsx', 'csv', 'png', 'jpg', 'txt'].map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setFormatFilter(fmt)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-medium uppercase shrink-0 border ${
                  formatFilter === fmt
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filteredDocs.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
                No matching documents found.
              </div>
            ) : (
              filteredDocs.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDoc(doc)}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2 active:bg-slate-800 cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-100 truncate">{doc.filename}</p>
                      <p className="text-[11px] text-slate-400">
                        {doc.format_type.toUpperCase()} · {formatFileSize(doc.file_size)} ·{' '}
                        {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      aria-label={`Preview ${doc.filename}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openPreview(doc);
                      }}
                      className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-indigo-300"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <MoreVertical className="w-4 h-4 text-slate-500" />
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2.5">
          {filteredProjects.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
              No cloud projects found. Save a Word, Slides, or Sheets project to sync across Web &amp; Mobile.
            </div>
          ) : (
            filteredProjects.map((proj) => {
              const isRenaming = renamingProjectId === proj.id;
              return (
                <div key={proj.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
                  {isRenaming ? (
                    <div className="flex items-center gap-2">
                      <label htmlFor={`rename-proj-${proj.id}`} className="sr-only">
                        New project title
                      </label>
                      <input
                        id={`rename-proj-${proj.id}`}
                        name="projectTitle"
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        className="flex-1 h-9 px-3 rounded-xl bg-slate-950 border border-indigo-500 text-xs text-slate-100 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRename(proj)}
                        aria-label="Save project name"
                        className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingProjectId(null)}
                        aria-label="Cancel rename"
                        className="w-9 h-9 rounded-xl bg-slate-800 text-slate-300 flex items-center justify-center"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-100 truncate">{proj.title}</p>
                        <p className="text-[11px] text-slate-400">
                          {proj.project_type.toUpperCase()} · v{proj.version} · {formatFileSize(proj.size_bytes)} ·{' '}
                          {new Date(proj.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingProjectId(proj.id);
                            setRenameDraft(proj.title);
                          }}
                          aria-label={`Rename ${proj.title}`}
                          className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 flex items-center justify-center"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteProjectTarget(proj)}
                          aria-label={`Delete ${proj.title}`}
                          className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 text-rose-400 flex items-center justify-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {(proj.project_type === 'docx' ||
                    proj.project_type === 'slides' ||
                    proj.project_type === 'sheets') && (
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => handleOpenProject(proj)}
                      className="w-full h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/35 text-indigo-200 text-xs font-semibold flex items-center justify-center gap-1.5 active:bg-indigo-600/30"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Open in{' '}
                      {proj.project_type === 'docx'
                        ? 'Word Studio'
                        : proj.project_type === 'slides'
                        ? 'Slides Studio'
                        : 'Sheets Studio'}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Slide-Up Document Action Sheet */}
      {selectedDoc && (
        <div
          className="fixed inset-0 z-40 bg-black/70 flex items-end"
          onClick={() => !busyAction && setSelectedDoc(null)}
        >
          <div
            className="w-full bg-slate-900 border-t border-slate-800 rounded-t-3xl p-4 pb-safe space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-100 truncate">{selectedDoc.filename}</h3>
                <p className="text-[11px] text-slate-400 font-mono truncate">
                  SHA-256: {selectedDoc.content_hash_sha256.slice(0, 16)}… · {formatFileSize(selectedDoc.file_size)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close document actions"
                onClick={() => setSelectedDoc(null)}
                className="p-1.5 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => handleDocAction('preview')}
                className="col-span-2 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center gap-2 font-semibold"
              >
                <Eye className="w-4 h-4" /> Preview Document
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => handleDocAction('download')}
                className="h-11 rounded-xl bg-slate-800 flex items-center justify-center gap-2 font-medium"
              >
                <Download className="w-4 h-4 text-cyan-400" /> Save to Device
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => handleDocAction('share')}
                className="h-11 rounded-xl bg-slate-800 flex items-center justify-center gap-2 font-medium"
              >
                <Share2 className="w-4 h-4 text-indigo-400" /> Native Share
              </button>
              {selectedFmt === 'pdf' && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => handleDocAction('pdf')}
                  className="h-11 rounded-xl bg-rose-600/20 border border-rose-500/30 flex items-center justify-center gap-2 font-medium text-rose-200"
                >
                  <FileText className="w-4 h-4" /> Open PDF Studio
                </button>
              )}
              {WORD_FORMATS.has(selectedFmt) && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => handleDocAction('word')}
                  className="h-11 rounded-xl bg-sky-600/20 border border-sky-500/30 flex items-center justify-center gap-2 font-medium text-sky-200"
                >
                  <PenTool className="w-4 h-4" /> Open Word Studio
                </button>
              )}
              {selectedFmt === 'pptx' && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => handleDocAction('slides')}
                  className="h-11 rounded-xl bg-orange-600/20 border border-orange-500/30 flex items-center justify-center gap-2 font-medium text-orange-200"
                >
                  <Presentation className="w-4 h-4" /> Open Slides Studio
                </button>
              )}
              {SHEET_FORMATS.has(selectedFmt) && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => handleDocAction('sheets')}
                  className="h-11 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center gap-2 font-medium text-emerald-200"
                >
                  <FileSpreadsheet className="w-4 h-4" /> Open Sheets
                </button>
              )}
              <button
                type="button"
                disabled={busyAction}
                onClick={() => handleDocAction('convert')}
                className="h-11 rounded-xl bg-slate-800 flex items-center justify-center gap-2 font-medium"
              >
                <Repeat className="w-4 h-4 text-amber-400" /> Convert File
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => handleDocAction('rag')}
                className="h-11 rounded-xl bg-slate-800 flex items-center justify-center gap-2 font-medium"
              >
                <Sparkles className="w-4 h-4 text-violet-400" /> Index for AI
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => handleDocAction('delete')}
                className="col-span-2 h-11 rounded-xl bg-rose-950/60 border border-rose-500/30 text-rose-300 flex items-center justify-center gap-2 font-medium"
              >
                <Trash2 className="w-4 h-4" /> Delete from Vault
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Document Preview Modal */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 flex items-center justify-center p-4"
          onClick={closePreview}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-100 truncate">{preview.doc.filename}</h3>
                <p className="text-[11px] text-slate-400">
                  {preview.doc.format_type.toUpperCase()} · {formatFileSize(preview.doc.file_size)} · v
                  {preview.doc.version}
                </p>
              </div>
              <button
                type="button"
                onClick={closePreview}
                aria-label="Close preview"
                className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              {preview.kind === 'loading' && (
                <div className="py-10 text-center space-y-2 text-xs text-slate-400">
                  <RefreshCw className="w-6 h-6 mx-auto animate-spin text-indigo-400" />
                  <p>
                    Loading preview{downloadState ? ` (${downloadState.percent}%)` : '...'}
                  </p>
                </div>
              )}

              {preview.kind === 'error' && (
                <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
                  {preview.error}
                </div>
              )}

              {preview.kind === 'image' && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2 flex items-center justify-center">
                  <img
                    src={preview.objectUrl}
                    alt={preview.doc.filename}
                    className="max-h-[55vh] w-auto object-contain rounded-lg"
                  />
                </div>
              )}

              {preview.kind === 'text' && (
                <div className="space-y-2">
                  {preview.truncated && (
                    <p className="text-[11px] text-amber-300">
                      Showing first 120,000 characters. Download the file for full contents.
                    </p>
                  )}
                  <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 whitespace-pre-wrap break-words max-h-[55vh] overflow-y-auto">
                    {preview.text}
                  </pre>
                </div>
              )}

              {(preview.kind === 'pdf' || preview.kind === 'metadata') && (
                <div className="space-y-3">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5 text-xs">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Document Metadata</p>
                    <p className="text-slate-300">
                      MIME: <span className="font-mono text-slate-100">{preview.doc.mime_type}</span>
                    </p>
                    <p className="text-slate-300 font-mono truncate">
                      SHA-256: {preview.doc.content_hash_sha256}
                    </p>
                    <p className="text-slate-300">
                      Created: {new Date(preview.doc.created_at).toLocaleString()}
                    </p>
                  </div>

                  {renderDigitalTwinSummary(preview.doc.digital_twin)}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex items-center gap-2">
              {preview.doc.format_type.toLowerCase() === 'pdf' && (
                <button
                  type="button"
                  onClick={async () => {
                    const target = preview.doc;
                    closePreview();
                    const f = await downloadAsFile(target);
                    onOpenInPdfStudio(f);
                  }}
                  className="flex-1 h-10 rounded-xl bg-indigo-600 text-xs font-semibold text-white"
                >
                  Open in PDF Studio
                </button>
              )}
              {WORD_FORMATS.has(preview.doc.format_type.toLowerCase()) && (
                <button
                  type="button"
                  onClick={async () => {
                    const target = preview.doc;
                    closePreview();
                    const f = await downloadAsFile(target);
                    onOpenInWordStudio(f);
                  }}
                  className="flex-1 h-10 rounded-xl bg-indigo-600 text-xs font-semibold text-white"
                >
                  Open in Word Studio
                </button>
              )}
              {preview.doc.format_type.toLowerCase() === 'pptx' && (
                <button
                  type="button"
                  onClick={async () => {
                    const target = preview.doc;
                    closePreview();
                    const f = await downloadAsFile(target);
                    onOpenInSlidesStudio(f);
                  }}
                  className="flex-1 h-10 rounded-xl bg-indigo-600 text-xs font-semibold text-white"
                >
                  Open in Slides Studio
                </button>
              )}
              <button
                type="button"
                onClick={closePreview}
                className="h-10 px-4 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteDocTarget)}
        title="Delete Document from Vault?"
        message={
          deleteDocTarget
            ? `Permanently delete "${deleteDocTarget.filename}" from the shared OmniDoc vault?`
            : ''
        }
        confirmLabel="Delete Document"
        danger
        busy={deleting}
        onConfirm={handleConfirmDeleteDoc}
        onCancel={() => !deleting && setDeleteDocTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteProjectTarget)}
        title="Delete Cloud Project?"
        message={
          deleteProjectTarget
            ? `Delete cloud project "${deleteProjectTarget.title}"? This removes it from your synced workspace.`
            : ''
        }
        confirmLabel="Delete Project"
        danger
        busy={deleting}
        onConfirm={handleConfirmDeleteProject}
        onCancel={() => !deleting && setDeleteProjectTarget(null)}
      />
    </div>
  );
};
