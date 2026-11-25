import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Cloud,
  Download,
  FileText,
  FolderKanban,
  MoreVertical,
  RefreshCw,
  Repeat,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { validateUploadFile } from '../engines/fileValidator';
import { formatFileSize } from '../engines/formatDetector';
import { imagesToPdf } from '../engines/pdfService';
import { apiClient } from '../services/apiClient';
import { captureDocumentPhoto, hapticTap, saveFileToDevice, shareDocumentFile } from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';
import { BackendDocument, CloudProjectSummary } from '../types';

interface LibraryScreenProps {
  onOpenInPdfStudio: (file: File) => void;
  onOpenInSheetsStudio: (file: File) => void;
  onOpenInConverter: (file: File) => void;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  onOpenInPdfStudio,
  onOpenInSheetsStudio,
  onOpenInConverter,
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
  const [selectedDoc, setSelectedDoc] = useState<BackendDocument | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const downloadAndConvertToFile = async (doc: BackendDocument): Promise<File> => {
    const blob = await apiClient.downloadDocument(doc.id);
    return new File([blob], doc.filename, { type: doc.mime_type || 'application/octet-stream' });
  };

  const handleDocAction = async (
    action: 'download' | 'share' | 'pdf' | 'sheets' | 'convert' | 'rag' | 'delete'
  ) => {
    if (!selectedDoc) return;
    const doc = selectedDoc;
    setBusyAction(true);
    try {
      if (action === 'download') {
        const blob = await apiClient.downloadDocument(doc.id);
        const saved = await saveFileToDevice(blob, doc.filename);
        await hapticTap('light');
        onToast('success', `Saved to ${saved.path}`);
      } else if (action === 'share') {
        const blob = await apiClient.downloadDocument(doc.id);
        await shareDocumentFile(blob, doc.filename, doc.filename);
      } else if (action === 'pdf') {
        const f = await downloadAndConvertToFile(doc);
        setSelectedDoc(null);
        onOpenInPdfStudio(f);
      } else if (action === 'sheets') {
        const f = await downloadAndConvertToFile(doc);
        setSelectedDoc(null);
        onOpenInSheetsStudio(f);
      } else if (action === 'convert') {
        const f = await downloadAndConvertToFile(doc);
        setSelectedDoc(null);
        onOpenInConverter(f);
      } else if (action === 'rag') {
        const res = await apiClient.indexDocumentRag(doc.id);
        onToast('success', `Indexed ${res.chunks_indexed} chunks for AI Q&A.`);
      } else if (action === 'delete') {
        await apiClient.deleteDocument(doc.id);
        onToast('success', `Deleted "${doc.filename}".`);
        setSelectedDoc(null);
        await refresh();
      }
    } catch (err: any) {
      onToast('error', err?.message || 'Action failed');
    } finally {
      setBusyAction(false);
    }
  };

  const filteredDocs = docs.filter((d) => {
    const matchesQuery = d.filename.toLowerCase().includes(search.toLowerCase());
    const matchesFormat = formatFilter === 'all' || d.format_type.toLowerCase() === formatFilter;
    return matchesQuery && matchesFormat;
  });

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
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadPct !== null}
          className="flex-1 h-11 rounded-xl bg-indigo-600 text-white text-xs font-semibold flex items-center justify-center gap-2 active:bg-indigo-700 disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          Upload Document
        </button>
        <button
          onClick={handleCameraUpload}
          disabled={uploadPct !== null}
          className="h-11 px-3.5 rounded-xl bg-slate-800 text-slate-100 text-xs font-semibold flex items-center gap-1.5 active:bg-slate-700"
        >
          <Camera className="w-4 h-4 text-cyan-400" />
          Scan
        </button>
        <button
          onClick={refresh}
          className="w-11 h-11 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300"
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

      {/* Documents vs Cloud Projects Switcher */}
      <div className="grid grid-cols-2 gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setSection('documents')}
          className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 ${
            section === 'documents' ? 'bg-slate-800 text-white' : 'text-slate-400'
          }`}
        >
          <Cloud className="w-3.5 h-3.5" /> Vault Files ({docs.length})
        </button>
        <button
          onClick={() => setSection('projects')}
          className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 ${
            section === 'projects' ? 'bg-slate-800 text-white' : 'text-slate-400'
          }`}
        >
          <FolderKanban className="w-3.5 h-3.5" /> Cloud Projects ({projects.length})
        </button>
      </div>

      {section === 'documents' ? (
        <>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vault documents..."
              className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-slate-900 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {['all', 'pdf', 'xlsx', 'csv', 'docx', 'png', 'jpg', 'txt'].map((fmt) => (
              <button
                key={fmt}
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
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
                No matching documents found.
              </div>
            ) : (
              filteredDocs.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDoc(doc)}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3 active:bg-slate-800"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{doc.filename}</p>
                      <p className="text-[11px] text-slate-400">
                        {doc.format_type.toUpperCase()} · {formatFileSize(doc.file_size)} ·{' '}
                        {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <MoreVertical className="w-4 h-4 text-slate-500 shrink-0" />
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          {projects.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
              No cloud projects found. Save a sheet or studio project to sync across Web &amp; Mobile.
            </div>
          ) : (
            projects.map((proj) => (
              <div key={proj.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{proj.title}</p>
                  <p className="text-[11px] text-slate-400">
                    {proj.project_type.toUpperCase()} · v{proj.version} · {formatFileSize(proj.size_bytes)}
                  </p>
                </div>
                <span className="text-[11px] text-slate-500">{new Date(proj.updated_at).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Slide-Up Document Action Sheet */}
      {selectedDoc && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={() => !busyAction && setSelectedDoc(null)}>
          <div
            className="w-full bg-slate-900 border-t border-slate-800 rounded-t-3xl p-4 pb-safe space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800">
              <div className="min-w-0">
                <h3 className="text-sm font-bold truncate">{selectedDoc.filename}</h3>
                <p className="text-[11px] text-slate-400 font-mono truncate">
                  SHA-256: {selectedDoc.content_hash_sha256.slice(0, 16)}… · {formatFileSize(selectedDoc.file_size)}
                </p>
              </div>
              <button onClick={() => setSelectedDoc(null)} className="p-1.5 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                disabled={busyAction}
                onClick={() => handleDocAction('download')}
                className="h-11 rounded-xl bg-slate-800 flex items-center justify-center gap-2 font-medium"
              >
                <Download className="w-4 h-4 text-cyan-400" /> Save to Device
              </button>
              <button
                disabled={busyAction}
                onClick={() => handleDocAction('share')}
                className="h-11 rounded-xl bg-slate-800 flex items-center justify-center gap-2 font-medium"
              >
                <Share2 className="w-4 h-4 text-indigo-400" /> Native Share
              </button>
              {selectedDoc.format_type.toLowerCase() === 'pdf' && (
                <button
                  disabled={busyAction}
                  onClick={() => handleDocAction('pdf')}
                  className="h-11 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center gap-2 font-medium text-indigo-200"
                >
                  <FileText className="w-4 h-4" /> Open PDF Studio
                </button>
              )}
              {(selectedDoc.format_type.toLowerCase() === 'xlsx' || selectedDoc.format_type.toLowerCase() === 'csv') && (
                <button
                  disabled={busyAction}
                  onClick={() => handleDocAction('sheets')}
                  className="h-11 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center gap-2 font-medium text-emerald-200"
                >
                  <FileText className="w-4 h-4" /> Open Sheets
                </button>
              )}
              <button
                disabled={busyAction}
                onClick={() => handleDocAction('convert')}
                className="h-11 rounded-xl bg-slate-800 flex items-center justify-center gap-2 font-medium"
              >
                <Repeat className="w-4 h-4 text-amber-400" /> Convert File
              </button>
              <button
                disabled={busyAction}
                onClick={() => handleDocAction('rag')}
                className="h-11 rounded-xl bg-slate-800 flex items-center justify-center gap-2 font-medium"
              >
                <Sparkles className="w-4 h-4 text-violet-400" /> Index for AI
              </button>
              <button
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
    </div>
  );
};
