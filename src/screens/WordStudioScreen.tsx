import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CloudUpload,
  Download,
  FilePlus2,
  FolderOpen,
  Heading1,
  Heading2,
  Italic,
  List,
  Pilcrow,
  Redo2,
  Search,
  Share2,
  Underline,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { escapeHtml } from '../engines/converter';
import {
  convertTextOrDocxToPdf,
  createDocxBlob,
  extractTextFromDocxFile,
  htmlToDocxItems,
  sanitizeHtml,
} from '../engines/docxService';
import { apiClient } from '../services/apiClient';
import { saveFileToDevice, shareDocumentFile } from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';
import { CloudProjectDetail } from '../types';

export interface WordStudioScreenProps {
  initialFile?: File | null;
  initialProject?: CloudProjectDetail | null;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}

const DEFAULT_DOCUMENT_HTML = sanitizeHtml(`
<h1>Project Brief</h1>
<p>Write, format, and export rich documents directly on your device or sync them to your OmniDoc cloud workspace.</p>
<h2>Key Highlights</h2>
<ul>
  <li>Offline-first rich text editing with XSS-safe HTML sanitization.</li>
  <li>Export to Word (.DOCX), PDF, Plain Text, or HTML.</li>
  <li>Cloud Project versioning synced across desktop and mobile.</li>
</ul>
`);

const BLANK_DOCUMENT_HTML = '<p>Start writing your document...</p>';

function textToSafeHtml(rawText: string): string {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const htmlParts: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      htmlParts.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    if (trimmed.startsWith('# ')) {
      closeList();
      htmlParts.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith('## ')) {
      closeList();
      htmlParts.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith('### ')) {
      closeList();
      htmlParts.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
      if (!inList) {
        htmlParts.push('<ul>');
        inList = true;
      }
      htmlParts.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`);
    } else {
      closeList();
      htmlParts.push(`<p>${escapeHtml(rawLine)}</p>`);
    }
  }
  closeList();

  return sanitizeHtml(htmlParts.join('') || '<p></p>');
}

function replaceTextInDom(root: HTMLElement, query: string, replacement: string): number {
  if (!query) return 0;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'gi');
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const parentTag = current.parentElement?.tagName?.toLowerCase();
    if (parentTag !== 'script' && parentTag !== 'style') {
      textNodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  let replacements = 0;
  for (const node of textNodes) {
    const value = node.nodeValue || '';
    if (regex.test(value)) {
      regex.lastIndex = 0;
      node.nodeValue = value.replace(regex, () => {
        replacements += 1;
        return replacement;
      });
    }
  }
  return replacements;
}

export const WordStudioScreen: React.FC<WordStudioScreenProps> = ({
  initialFile,
  initialProject,
  onToast,
}) => {
  const { isOnline } = useAuth();
  const [title, setTitle] = useState('Untitled_Document');
  const [exportFormat, setExportFormat] = useState<'docx' | 'pdf' | 'txt' | 'html'>('docx');
  const [wordsCount, setWordsCount] = useState(0);
  const [charsCount, setCharsCount] = useState(0);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [confirmNewDoc, setConfirmNewDoc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cloudProjectId, setCloudProjectId] = useState<string | null>(null);
  const [cloudVersion, setCloudVersion] = useState<number | undefined>(undefined);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateStats = useCallback(() => {
    if (!editorRef.current) return;
    const text = editorRef.current.innerText || editorRef.current.textContent || '';
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    setWordsCount(words);
    setCharsCount(text.length);
  }, []);

  const setEditorContent = useCallback(
    (rawHtmlOrText: string, isHtml: boolean) => {
      if (!editorRef.current) return;
      editorRef.current.innerHTML = isHtml ? sanitizeHtml(rawHtmlOrText) : textToSafeHtml(rawHtmlOrText);
      updateStats();
    },
    [updateStats]
  );

  // Initialize default document once if neither file nor project is provided
  useEffect(() => {
    if (!initialFile && !initialProject && editorRef.current && !editorRef.current.innerHTML.trim()) {
      editorRef.current.innerHTML = DEFAULT_DOCUMENT_HTML;
      updateStats();
    }
  }, [initialFile, initialProject, updateStats]);

  const loadDocumentFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const lower = file.name.toLowerCase();
        const baseName = file.name.replace(/\.[^/.]+$/, '') || 'Document';
        if (lower.endsWith('.docx')) {
          const text = await extractTextFromDocxFile(file);
          setEditorContent(text, false);
        } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
          const html = await file.text();
          setEditorContent(html, true);
        } else {
          const text = await file.text();
          setEditorContent(text, false);
        }
        setTitle(baseName);
        setCloudProjectId(null);
        setCloudVersion(undefined);
        onToast('success', `Opened "${file.name}"`);
      } catch (err: any) {
        onToast('error', err?.message || 'Could not open document');
      } finally {
        setBusy(false);
      }
    },
    [onToast, setEditorContent]
  );

  useEffect(() => {
    if (initialFile) {
      loadDocumentFile(initialFile);
    }
  }, [initialFile, loadDocumentFile]);

  useEffect(() => {
    if (!initialProject) return;
    setTitle(initialProject.title || 'Cloud Document');
    setCloudProjectId(initialProject.id);
    setCloudVersion(initialProject.version);
    const data = initialProject.data || {};
    const rawContent =
      typeof data.content === 'string'
        ? data.content
        : typeof data.html === 'string'
        ? data.html
        : typeof data.text === 'string'
        ? data.text
        : '';
    const looksLikeHtml = /<[a-z][\s\S]*>/i.test(rawContent);
    setEditorContent(rawContent || BLANK_DOCUMENT_HTML, looksLikeHtml || !rawContent);
    onToast('info', `Loaded project "${initialProject.title}" (v${initialProject.version})`);
  }, [initialProject, onToast, setEditorContent]);

  const execFormat = (command: string, value?: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, value);
    updateStats();
  };

  const handleFindReplaceAll = () => {
    if (!editorRef.current || !findQuery) return;
    const count = replaceTextInDom(editorRef.current, findQuery, replaceQuery);
    updateStats();
    onToast('info', count > 0 ? `Replaced ${count} occurrence(s).` : 'No matches found.');
  };

  const handleConfirmNewDocument = () => {
    setTitle('Untitled_Document');
    setCloudProjectId(null);
    setCloudVersion(undefined);
    setEditorContent(BLANK_DOCUMENT_HTML, true);
    setConfirmNewDoc(false);
    onToast('info', 'Started a blank document.');
  };

  const buildExportBlob = async (fmt: 'docx' | 'pdf' | 'txt' | 'html'): Promise<{ blob: Blob; filename: string }> => {
    const safeTitle = (title || 'Document').trim();
    const rawHtml = editorRef.current?.innerHTML || '';
    const cleanHtml = sanitizeHtml(rawHtml);
    const plainText = editorRef.current?.innerText || editorRef.current?.textContent || '';

    if (fmt === 'docx') {
      const items = htmlToDocxItems(cleanHtml);
      const blob = await createDocxBlob(safeTitle, items);
      return { blob, filename: `${safeTitle}.docx` };
    }
    if (fmt === 'pdf') {
      const pdfBytes = await convertTextOrDocxToPdf(safeTitle, plainText);
      return { blob: new Blob([pdfBytes as any], { type: 'application/pdf' }), filename: `${safeTitle}.pdf` };
    }
    if (fmt === 'txt') {
      return { blob: new Blob([plainText], { type: 'text/plain;charset=utf-8' }), filename: `${safeTitle}.txt` };
    }

    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
      safeTitle
    )}</title></head><body style="font-family:sans-serif;max-width:800px;margin:32px auto;padding:20px;line-height:1.6;"><h1>${escapeHtml(
      safeTitle
    )}</h1>${cleanHtml}</body></html>`;
    return { blob: new Blob([fullHtml], { type: 'text/html;charset=utf-8' }), filename: `${safeTitle}.html` };
  };

  const handleExportAction = async (mode: 'save' | 'share' | 'upload') => {
    setBusy(true);
    try {
      const { blob, filename } = await buildExportBlob(exportFormat);
      if (mode === 'save') {
        const saved = await saveFileToDevice(blob, filename);
        onToast('success', `Saved to ${saved.path}`);
      } else if (mode === 'share') {
        await shareDocumentFile(blob, filename, filename);
      } else {
        const uploaded = await apiClient.uploadDocument(
          new File([blob], filename, { type: blob.type || 'application/octet-stream' })
        );
        onToast('success', `Uploaded "${uploaded.filename}" to vault.`);
      }

      await offlineStore.appendHistory({
        kind: mode === 'upload' ? 'upload' : 'conversion',
        title: `${mode === 'upload' ? 'Uploaded' : 'Exported'} ${filename}`,
        sourceFormat: 'docx',
        targetFormat: exportFormat,
        sizeBytes: blob.size,
        status: 'completed',
      });
    } catch (err: any) {
      onToast('error', err?.message || 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCloudProject = async () => {
    if (!isOnline) {
      onToast('error', 'Cloud project sync requires an internet connection.');
      return;
    }
    setBusy(true);
    try {
      const cleanHtml = sanitizeHtml(editorRef.current?.innerHTML || '');
      const plainText = editorRef.current?.innerText || '';
      const payloadData = { content: cleanHtml, plainText, wordsCount, charsCount };

      if (cloudProjectId) {
        const updated = await apiClient.updateProject(cloudProjectId, {
          title: title.trim() || 'Untitled Document',
          data: payloadData,
          expected_version: cloudVersion,
          note: 'Updated from OmniDoc Mobile Word Studio',
        });
        setCloudVersion(updated.version);
        onToast('success', `Updated Cloud Project "${updated.title}" (v${updated.version})`);
      } else {
        const created = await apiClient.createProject({
          title: title.trim() || 'Untitled Document',
          project_type: 'docx',
          data: payloadData,
          note: 'Created from OmniDoc Mobile Word Studio',
        });
        setCloudProjectId(created.id);
        setCloudVersion(created.version);
        onToast('success', `Saved Cloud Project "${created.title}" (v${created.version})`);
      }
    } catch (err: any) {
      onToast('error', err?.message || 'Cloud project save failed');
    } finally {
      setBusy(false);
    }
  };

  const readMinutes = Math.max(1, Math.ceil(wordsCount / 200));

  return (
    <div className="space-y-3 pb-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.txt,.html,.htm,.md"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadDocumentFile(f);
          e.target.value = '';
        }}
      />

      {/* Top Title & File Actions */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Document title"
          placeholder="Document title"
          className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-100 focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setConfirmNewDoc(true)}
          className="h-10 px-2.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1 shrink-0 active:bg-slate-700"
          title="New blank document"
        >
          <FilePlus2 className="w-4 h-4 text-sky-400" />
          <span>New</span>
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="h-10 px-2.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1 shrink-0 active:bg-slate-700"
          title="Open DOCX, TXT, HTML, or MD"
        >
          <FolderOpen className="w-4 h-4 text-indigo-400" />
          <span>Open</span>
        </button>
        <button
          type="button"
          onClick={handleSaveCloudProject}
          disabled={!isOnline || busy}
          className="h-10 px-3 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center gap-1 shrink-0 disabled:opacity-40 active:bg-indigo-500"
          title={cloudProjectId ? 'Update Cloud Project' : 'Save to Cloud Projects'}
        >
          <CloudUpload className="w-4 h-4" />
          <span>{cloudProjectId ? 'Update' : 'Sync'}</span>
        </button>
      </div>

      {cloudProjectId && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/25 text-[11px] text-indigo-200">
          <span>Linked to Cloud Project (v{cloudVersion ?? 1})</span>
          <span className="font-mono text-[10px] text-indigo-300">DOCX</span>
        </div>
      )}

      {/* Inline New Document Confirmation */}
      {confirmNewDoc && (
        <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/40 flex items-center justify-between gap-2 text-xs">
          <span className="text-amber-100 font-medium">Start a new blank document? Unsaved edits will be cleared.</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleConfirmNewDocument}
              className="px-2.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-semibold"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setConfirmNewDoc(false)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Touch Formatting Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-1.5 flex items-center gap-1 overflow-x-auto">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('undo')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-300 hover:bg-slate-800 active:bg-slate-700 flex items-center justify-center"
          title="Undo"
          aria-label="Undo"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('redo')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-300 hover:bg-slate-800 active:bg-slate-700 flex items-center justify-center"
          title="Redo"
          aria-label="Redo"
        >
          <Redo2 className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-700 mx-0.5 shrink-0" />

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('bold')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-200 hover:bg-slate-800 active:bg-indigo-600/40 flex items-center justify-center"
          title="Bold"
          aria-label="Bold"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('italic')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-200 hover:bg-slate-800 active:bg-indigo-600/40 flex items-center justify-center"
          title="Italic"
          aria-label="Italic"
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('underline')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-200 hover:bg-slate-800 active:bg-indigo-600/40 flex items-center justify-center"
          title="Underline"
          aria-label="Underline"
        >
          <Underline className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-700 mx-0.5 shrink-0" />

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('formatBlock', '<h1>')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-200 hover:bg-slate-800 active:bg-indigo-600/40 flex items-center justify-center"
          title="Heading 1"
          aria-label="Heading 1"
        >
          <Heading1 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('formatBlock', '<h2>')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-200 hover:bg-slate-800 active:bg-indigo-600/40 flex items-center justify-center"
          title="Heading 2"
          aria-label="Heading 2"
        >
          <Heading2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('formatBlock', '<p>')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-300 hover:bg-slate-800 active:bg-indigo-600/40 flex items-center justify-center"
          title="Paragraph"
          aria-label="Paragraph"
        >
          <Pilcrow className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('insertUnorderedList')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-200 hover:bg-slate-800 active:bg-indigo-600/40 flex items-center justify-center"
          title="Bullet List"
          aria-label="Bullet List"
        >
          <List className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-700 mx-0.5 shrink-0" />

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('justifyLeft')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-300 hover:bg-slate-800 active:bg-indigo-600/40 flex items-center justify-center"
          title="Align Left"
          aria-label="Align Left"
        >
          <AlignLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('justifyCenter')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-300 hover:bg-slate-800 active:bg-indigo-600/40 flex items-center justify-center"
          title="Align Center"
          aria-label="Align Center"
        >
          <AlignCenter className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('justifyRight')}
          className="h-9 min-w-[36px] px-2 rounded-lg text-slate-300 hover:bg-slate-800 active:bg-indigo-600/40 flex items-center justify-center"
          title="Align Right"
          aria-label="Align Right"
        >
          <AlignRight className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-slate-700 mx-0.5 shrink-0" />

        <button
          type="button"
          onClick={() => setShowFindReplace((v) => !v)}
          className={`h-9 min-w-[36px] px-2 rounded-lg flex items-center justify-center ${
            showFindReplace ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
          title="Find and Replace"
          aria-label="Find and Replace"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>

      {/* Find & Replace Bar */}
      {showFindReplace && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder="Find text..."
              aria-label="Find text"
              className="flex-1 h-9 px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
            <input
              type="text"
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              placeholder="Replace with..."
              aria-label="Replace with"
              className="flex-1 h-9 px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleFindReplaceAll}
              disabled={!findQuery}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-40"
            >
              Replace All
            </button>
            <button
              type="button"
              onClick={() => setShowFindReplace(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              aria-label="Close find and replace"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Mobile Rich-Text Document Surface */}
      <div className="bg-white text-slate-900 rounded-2xl border border-slate-700/60 shadow-lg p-4 min-h-[300px] max-h-[420px] overflow-y-auto select-text">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={updateStats}
          role="textbox"
          aria-multiline="true"
          aria-label="Document rich text editor"
          className="outline-none min-h-[260px] text-sm leading-relaxed text-slate-800 [&>h1]:text-xl [&>h1]:font-bold [&>h1]:text-slate-900 [&>h1]:mb-2 [&>h2]:text-base [&>h2]:font-bold [&>h2]:text-slate-900 [&>h2]:mt-3 [&>h2]:mb-1.5 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-indigo-700 [&>p]:mb-2 [&>ul]:list-disc [&>ul]:ml-5 [&>ul]:mb-2 [&>ol]:list-decimal [&>ol]:ml-5 [&>ol]:mb-2"
        />
      </div>

      {/* Live Word / Character Counter */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 font-medium">
        <span>
          <strong className="text-slate-200">{wordsCount}</strong> words ·{' '}
          <strong className="text-slate-200">{charsCount}</strong> characters
        </span>
        <span>~{readMinutes} min read</span>
      </div>

      {/* Export / Share / Upload */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-400 font-semibold uppercase">Export Document</p>
          <div className="flex gap-1">
            {(['docx', 'pdf', 'txt', 'html'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setExportFormat(fmt)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase ${
                  exportFormat === fmt
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                .{fmt}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => handleExportAction('save')}
            className="h-10 rounded-xl bg-sky-600/20 border border-sky-500/30 text-sky-200 text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleExportAction('share')}
            className="h-10 rounded-xl bg-slate-800 text-slate-100 text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-40"
          >
            <Share2 className="w-3.5 h-3.5 text-indigo-400" /> Share
          </button>
          <button
            type="button"
            disabled={busy || !isOnline}
            onClick={() => handleExportAction('upload')}
            className="h-10 rounded-xl bg-indigo-600 text-white text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-40"
          >
            <Upload className="w-3.5 h-3.5" /> Upload
          </button>
        </div>
      </div>
    </div>
  );
};
