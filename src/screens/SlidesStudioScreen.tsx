import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Palette,
  Play,
  Plus,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { convertSlidesToPdf, createPresentationBlob, extractTextFromPptxFile } from '../engines/pptxService';
import { apiClient } from '../services/apiClient';
import { saveFileToDevice, shareDocumentFile } from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';
import { CloudProjectDetail, SlideItem } from '../types';

export interface SlidesStudioScreenProps {
  initialFile?: File | null;
  initialProject?: CloudProjectDetail | null;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}

const THEME_PRESETS: Array<{ label: string; color: string }> = [
  { label: 'Dark Navy', color: '#0f172a' },
  { label: 'Deep Indigo', color: '#1e1b4b' },
  { label: 'Emerald', color: '#042f2e' },
  { label: 'Slate', color: '#1e293b' },
  { label: 'Midnight', color: '#09090b' },
  { label: 'Burgundy', color: '#3b0a18' },
];

function createDefaultSlides(): SlideItem[] {
  return [
    {
      id: `s-${Date.now()}-1`,
      title: 'Title Slide',
      bgColor: '#0f172a',
      layout: 'title',
      elements: [
        {
          id: `el-${Date.now()}-1`,
          type: 'title',
          content: 'OmniDoc Presentation',
          x: 8,
          y: 22,
          width: 84,
          height: 24,
          fontSize: 36,
          fontColor: '#ffffff',
        },
        {
          id: `el-${Date.now()}-2`,
          type: 'text',
          content: 'Create, edit, present, and export 16:9 PowerPoint decks right from mobile.',
          x: 8,
          y: 52,
          width: 84,
          height: 30,
          fontSize: 18,
          fontColor: '#cbd5e1',
        },
      ],
    },
    {
      id: `s-${Date.now()}-2`,
      title: 'Key Takeaways',
      bgColor: '#1e1b4b',
      layout: 'content',
      elements: [
        {
          id: `el-${Date.now()}-3`,
          type: 'title',
          content: 'Key Highlights',
          x: 8,
          y: 12,
          width: 84,
          height: 18,
          fontSize: 30,
          fontColor: '#ffffff',
        },
        {
          id: `el-${Date.now()}-4`,
          type: 'text',
          content:
            '* Offline-ready OpenXML PPTX creation\n* Instant PDF slide deck export\n* Cloud Project sync with version control',
          x: 8,
          y: 35,
          width: 84,
          height: 55,
          fontSize: 16,
          fontColor: '#c7d2fe',
        },
      ],
    },
  ];
}

export const SlidesStudioScreen: React.FC<SlidesStudioScreenProps> = ({
  initialFile,
  initialProject,
  onToast,
}) => {
  const { isOnline } = useAuth();
  const [deckTitle, setDeckTitle] = useState('Mobile_Presentation');
  const [slides, setSlides] = useState<SlideItem[]>(() => createDefaultSlides());
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPresenting, setIsPresenting] = useState(false);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
  const [confirmNewDeck, setConfirmNewDeck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cloudProjectId, setCloudProjectId] = useState<string | null>(null);
  const [cloudVersion, setCloudVersion] = useState<number | undefined>(undefined);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const touchStartX = useRef<number | null>(null);

  const activeSlide = slides[activeIndex] || slides[0];
  const titleEl = activeSlide?.elements.find((e) => e.type === 'title');
  const bodyEl = activeSlide?.elements.find((e) => e.type === 'text');

  const loadPptxFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const slidesText = await extractTextFromPptxFile(file);
        const parsed: SlideItem[] = slidesText.map((content, idx) => {
          const lines = content.split('\n').filter(Boolean);
          const heading = lines[0] || `Slide ${idx + 1}`;
          const body = lines.slice(1).join('\n');
          return {
            id: `slide-imp-${Date.now()}-${idx}`,
            title: heading.length > 32 ? `${heading.slice(0, 30)}...` : heading,
            bgColor: '#0f172a',
            layout: idx === 0 ? 'title' : 'content',
            elements: [
              {
                id: `el-t-${Date.now()}-${idx}`,
                type: 'title',
                content: heading,
                x: 8,
                y: idx === 0 ? 22 : 12,
                width: 84,
                height: 20,
                fontSize: idx === 0 ? 36 : 30,
                fontColor: '#ffffff',
              },
              {
                id: `el-b-${Date.now()}-${idx}`,
                type: 'text',
                content: body,
                x: 8,
                y: idx === 0 ? 50 : 35,
                width: 84,
                height: 55,
                fontSize: 16,
                fontColor: '#cbd5e1',
              },
            ],
          };
        });

        if (parsed.length > 0) {
          setSlides(parsed);
          setActiveIndex(0);
          setDeckTitle(file.name.replace(/\.[^/.]+$/, '') || 'Presentation');
          setCloudProjectId(null);
          setCloudVersion(undefined);
          setConfirmDeleteIdx(null);
          onToast('success', `Imported "${file.name}" (${parsed.length} slide(s))`);
        }
      } catch (err: any) {
        onToast('error', err?.message || 'Could not parse PPTX file');
      } finally {
        setBusy(false);
      }
    },
    [onToast]
  );

  useEffect(() => {
    if (initialFile) {
      loadPptxFile(initialFile);
    }
  }, [initialFile, loadPptxFile]);

  useEffect(() => {
    if (!initialProject) return;
    const loadedSlides = initialProject.data?.slides;
    setDeckTitle(initialProject.title || 'Cloud Presentation');
    setCloudProjectId(initialProject.id);
    setCloudVersion(initialProject.version);
    if (Array.isArray(loadedSlides) && loadedSlides.length > 0) {
      setSlides(loadedSlides);
      setActiveIndex(0);
    }
    setConfirmDeleteIdx(null);
    onToast('info', `Loaded deck "${initialProject.title}" (v${initialProject.version})`);
  }, [initialProject, onToast]);

  const updateSlideElementText = (elType: 'title' | 'text', newContent: string) => {
    setSlides((prev) =>
      prev.map((slide, idx) => {
        if (idx !== activeIndex) return slide;
        const existing = slide.elements.find((e) => e.type === elType);
        const updatedElements = existing
          ? slide.elements.map((e) => (e.id === existing.id ? { ...e, content: newContent } : e))
          : [
              ...slide.elements,
              {
                id: `el-${Date.now()}-${elType}`,
                type: elType,
                content: newContent,
                x: 8,
                y: elType === 'title' ? 12 : 35,
                width: 84,
                height: elType === 'title' ? 20 : 55,
                fontSize: elType === 'title' ? 30 : 16,
                fontColor: elType === 'title' ? '#ffffff' : '#cbd5e1',
              },
            ];
        return {
          ...slide,
          title: elType === 'title' ? newContent.slice(0, 36) || `Slide ${idx + 1}` : slide.title,
          elements: updatedElements,
        };
      })
    );
  };

  const updateSlideBgColor = (color: string) => {
    setSlides((prev) => prev.map((slide, idx) => (idx === activeIndex ? { ...slide, bgColor: color } : slide)));
  };

  const handleAddSlide = () => {
    const stamp = Date.now();
    const newSlide: SlideItem = {
      id: `slide-${stamp}`,
      title: `Slide ${slides.length + 1}`,
      bgColor: activeSlide?.bgColor || '#0f172a',
      layout: 'content',
      elements: [
        {
          id: `el-${stamp}-t`,
          type: 'title',
          content: 'New Slide Title',
          x: 8,
          y: 12,
          width: 84,
          height: 20,
          fontSize: 30,
          fontColor: '#ffffff',
        },
        {
          id: `el-${stamp}-b`,
          type: 'text',
          content: 'Add talking points or key metrics here...',
          x: 8,
          y: 35,
          width: 84,
          height: 55,
          fontSize: 16,
          fontColor: '#cbd5e1',
        },
      ],
    };
    setSlides((prev) => [...prev, newSlide]);
    setActiveIndex(slides.length);
    setConfirmDeleteIdx(null);
  };

  const handleDuplicateSlide = () => {
    const target = activeSlide;
    if (!target) return;
    const stamp = Date.now();
    const copy: SlideItem = {
      ...target,
      id: `slide-${stamp}`,
      title: `${target.title} (Copy)`,
      elements: target.elements.map((el, i) => ({ ...el, id: `el-${stamp}-${i}` })),
    };
    const next = [...slides];
    next.splice(activeIndex + 1, 0, copy);
    setSlides(next);
    setActiveIndex(activeIndex + 1);
    setConfirmDeleteIdx(null);
    onToast('info', 'Duplicated slide.');
  };

  const handleMoveSlide = (direction: -1 | 1) => {
    const targetIdx = activeIndex + direction;
    if (targetIdx < 0 || targetIdx >= slides.length) return;
    const next = [...slides];
    const [moved] = next.splice(activeIndex, 1);
    next.splice(targetIdx, 0, moved);
    setSlides(next);
    setActiveIndex(targetIdx);
    setConfirmDeleteIdx(null);
  };

  const handleConfirmDeleteSlide = () => {
    if (confirmDeleteIdx === null || slides.length <= 1) {
      setConfirmDeleteIdx(null);
      return;
    }
    const idx = confirmDeleteIdx;
    setSlides((prev) => prev.filter((_, i) => i !== idx));
    setActiveIndex((curr) => Math.max(0, Math.min(curr, slides.length - 2)));
    setConfirmDeleteIdx(null);
    onToast('info', `Deleted slide ${idx + 1}.`);
  };

  const handleConfirmNewDeck = () => {
    setDeckTitle('Mobile_Presentation');
    setSlides(createDefaultSlides());
    setActiveIndex(0);
    setCloudProjectId(null);
    setCloudVersion(undefined);
    setConfirmNewDeck(false);
    setConfirmDeleteIdx(null);
    onToast('info', 'Created new presentation deck.');
  };

  const handleExport = async (fmt: 'pptx' | 'pdf', mode: 'save' | 'share' | 'upload') => {
    setBusy(true);
    try {
      const safeTitle = (deckTitle || 'Presentation').trim();
      let blob: Blob;
      const outName = fmt === 'pptx' ? `${safeTitle}.pptx` : `${safeTitle}_slides.pdf`;

      if (fmt === 'pptx') {
        blob = await createPresentationBlob(safeTitle, slides);
      } else {
        const pdfBytes = await convertSlidesToPdf(safeTitle, slides);
        blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
      }

      if (mode === 'save') {
        const saved = await saveFileToDevice(blob, outName);
        onToast('success', `Saved to ${saved.path}`);
      } else if (mode === 'share') {
        await shareDocumentFile(blob, outName, outName);
      } else {
        const uploaded = await apiClient.uploadDocument(
          new File([blob], outName, { type: blob.type || 'application/octet-stream' })
        );
        onToast('success', `Uploaded "${uploaded.filename}" to vault.`);
      }

      await offlineStore.appendHistory({
        kind: mode === 'upload' ? 'upload' : 'conversion',
        title: `${mode === 'upload' ? 'Uploaded' : 'Exported'} ${outName}`,
        sourceFormat: 'pptx',
        targetFormat: fmt,
        sizeBytes: blob.size,
        status: 'completed',
      });
    } catch (err: any) {
      onToast('error', err?.message || 'Presentation export failed');
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
      const payloadData = { slides };
      if (cloudProjectId) {
        const updated = await apiClient.updateProject(cloudProjectId, {
          title: deckTitle.trim() || 'Mobile Presentation',
          data: payloadData,
          expected_version: cloudVersion,
          note: 'Updated from OmniDoc Mobile Slides Studio',
        });
        setCloudVersion(updated.version);
        onToast('success', `Updated Cloud Deck "${updated.title}" (v${updated.version})`);
      } else {
        const created = await apiClient.createProject({
          title: deckTitle.trim() || 'Mobile Presentation',
          project_type: 'slides',
          data: payloadData,
          note: 'Created from OmniDoc Mobile Slides Studio',
        });
        setCloudProjectId(created.id);
        setCloudVersion(created.version);
        onToast('success', `Saved Cloud Deck "${created.title}" (v${created.version})`);
      }
    } catch (err: any) {
      onToast('error', err?.message || 'Cloud sync failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 pb-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadPptxFile(f);
          e.target.value = '';
        }}
      />

      {/* Top Controls */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={deckTitle}
          onChange={(e) => setDeckTitle(e.target.value)}
          aria-label="Presentation title"
          placeholder="Deck title"
          className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-100 focus:border-amber-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setConfirmNewDeck(true)}
          className="h-10 px-2.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1 shrink-0"
          title="New deck"
        >
          <FilePlus2 className="w-4 h-4 text-amber-400" /> New
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="h-10 px-2.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1 shrink-0"
          title="Open PPTX"
        >
          <FolderOpen className="w-4 h-4 text-amber-400" /> Open
        </button>
        <button
          type="button"
          onClick={handleSaveCloudProject}
          disabled={!isOnline || busy}
          className="h-10 px-3 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center gap-1 shrink-0 disabled:opacity-40"
        >
          <CloudUpload className="w-4 h-4" />
          <span>{cloudProjectId ? 'Update' : 'Sync'}</span>
        </button>
      </div>

      {cloudProjectId && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200">
          <span>Linked to Cloud Deck (v{cloudVersion ?? 1})</span>
          <span className="font-mono text-[10px] text-amber-300">PPTX 16:9</span>
        </div>
      )}

      {confirmNewDeck && (
        <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/40 flex items-center justify-between gap-2 text-xs">
          <span className="text-amber-100 font-medium">Create a new deck? Current unsaved slides will be replaced.</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleConfirmNewDeck}
              className="px-2.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-semibold"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmNewDeck(false)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Horizontal Slide Thumbnail Strip */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold uppercase tracking-wide">
          <span>Slides ({slides.length})</span>
          <button
            type="button"
            onClick={() => setIsPresenting(true)}
            className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-semibold flex items-center gap-1 normal-case"
          >
            <Play className="w-3.5 h-3.5 fill-amber-300 text-amber-300" /> Present
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {slides.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setActiveIndex(idx);
                setConfirmDeleteIdx(null);
              }}
              className={`w-28 shrink-0 rounded-xl p-2 border text-left transition-all ${
                idx === activeIndex
                  ? 'border-amber-400 ring-1 ring-amber-400/50 bg-slate-800'
                  : 'border-slate-800 bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-300 mb-1">
                <span>Slide {idx + 1}</span>
              </div>
              <div
                className="w-full aspect-[16/9] rounded-lg p-1.5 border border-white/10 overflow-hidden flex flex-col justify-center"
                style={{ backgroundColor: s.bgColor }}
              >
                <p className="text-[9px] font-bold text-white truncate">
                  {s.elements.find((e) => e.type === 'title')?.content || 'Untitled'}
                </p>
                <p className="text-[7px] text-slate-300 truncate mt-0.5">
                  {s.elements.find((e) => e.type === 'text')?.content || ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Slide Management Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-1.5 flex items-center justify-between gap-1 overflow-x-auto">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleAddSlide}
            className="h-9 px-2.5 rounded-lg bg-slate-800 text-xs font-semibold text-slate-100 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" /> Add
          </button>
          <button
            type="button"
            onClick={handleDuplicateSlide}
            className="h-9 px-2.5 rounded-lg bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1"
          >
            <Copy className="w-3.5 h-3.5 text-sky-400" /> Duplicate
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleMoveSlide(-1)}
            disabled={activeIndex === 0}
            className="h-9 w-9 rounded-lg bg-slate-800 text-slate-200 flex items-center justify-center disabled:opacity-30"
            title="Move slide left/up"
            aria-label="Move slide left"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleMoveSlide(1)}
            disabled={activeIndex === slides.length - 1}
            className="h-9 w-9 rounded-lg bg-slate-800 text-slate-200 flex items-center justify-center disabled:opacity-30"
            title="Move slide right/down"
            aria-label="Move slide right"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDeleteIdx(activeIndex)}
            disabled={slides.length <= 1}
            className="h-9 w-9 rounded-lg bg-rose-950/50 border border-rose-500/30 text-rose-300 flex items-center justify-center disabled:opacity-30"
            title="Delete slide"
            aria-label="Delete slide"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Inline Delete Slide Confirmation */}
      {confirmDeleteIdx !== null && (
        <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 flex items-center justify-between gap-2 text-xs">
          <span className="text-rose-100 font-medium">Delete Slide {confirmDeleteIdx + 1}?</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleConfirmDeleteSlide}
              className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-semibold"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteIdx(null)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Background Theme Presets */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
          <Palette className="w-4 h-4 text-amber-400" />
          <span>Theme</span>
        </div>
        <div className="flex items-center gap-2">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.color}
              type="button"
              onClick={() => updateSlideBgColor(preset.color)}
              title={preset.label}
              aria-label={`Theme ${preset.label}`}
              className={`w-6 h-6 rounded-full border transition-transform ${
                activeSlide?.bgColor === preset.color
                  ? 'ring-2 ring-amber-400 border-white scale-110'
                  : 'border-white/25'
              }`}
              style={{ backgroundColor: preset.color }}
            />
          ))}
        </div>
      </div>

      {/* Active 16:9 Slide Editor */}
      {activeSlide && (
        <div
          className="w-full aspect-[16/9] rounded-2xl border border-slate-700/80 shadow-xl p-4 flex flex-col justify-between transition-colors"
          style={{ backgroundColor: activeSlide.bgColor }}
        >
          <div className="space-y-2 flex-1 flex flex-col">
            <input
              type="text"
              value={titleEl?.content || ''}
              onChange={(e) => updateSlideElementText('title', e.target.value)}
              placeholder="Slide title..."
              aria-label="Slide title"
              className="w-full bg-transparent text-lg font-extrabold text-white placeholder:text-slate-400/70 outline-none border-b border-white/10 focus:border-amber-400 pb-1"
            />
            <textarea
              value={bodyEl?.content || ''}
              onChange={(e) => updateSlideElementText('text', e.target.value)}
              placeholder="Slide body text or bullet points..."
              aria-label="Slide body text"
              className="w-full flex-1 bg-transparent text-xs text-slate-200 placeholder:text-slate-400/70 outline-none resize-none leading-relaxed pt-1"
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-300/70 pt-1.5 border-t border-white/10">
            <span className="truncate max-w-[65%]">{deckTitle}</span>
            <span>
              Slide {activeIndex + 1} / {slides.length}
            </span>
          </div>
        </div>
      )}

      {/* Export / Share / Upload */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
        <p className="text-[11px] text-slate-400 font-semibold uppercase">Export Presentation</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => handleExport('pptx', 'save')}
            className="h-10 rounded-xl bg-amber-600/20 border border-amber-500/30 text-amber-200 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> Save .PPTX
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleExport('pdf', 'save')}
            className="h-10 rounded-xl bg-slate-800 text-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5 text-rose-400" /> Save .PDF
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => handleExport('pptx', 'share')}
            className="h-10 rounded-xl bg-slate-800 text-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Share2 className="w-4 h-4 text-indigo-400" /> Share PPTX
          </button>
          <button
            type="button"
            disabled={busy || !isOnline}
            onClick={() => handleExport('pptx', 'upload')}
            className="h-10 rounded-xl bg-indigo-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Upload className="w-4 h-4" /> Upload to Vault
          </button>
        </div>
      </div>

      {/* Fullscreen Mobile Presentation Mode */}
      {isPresenting && activeSlide && (
        <div
          className="fixed inset-0 z-50 bg-black flex flex-col justify-between p-4 pt-safe pb-safe"
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            if (touchStartX.current === null) return;
            const deltaX = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
            touchStartX.current = null;
            if (deltaX < -45) {
              setActiveIndex((i) => Math.min(slides.length - 1, i + 1));
            } else if (deltaX > 45) {
              setActiveIndex((i) => Math.max(0, i - 1));
            }
          }}
        >
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-xs font-semibold uppercase tracking-wider truncate max-w-[75%]">{deckTitle}</span>
            <button
              type="button"
              onClick={() => setIsPresenting(false)}
              className="w-10 h-10 rounded-xl bg-white/10 text-white flex items-center justify-center"
              aria-label="Exit presentation mode"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div
            className="w-full max-w-2xl mx-auto aspect-[16/9] rounded-2xl p-6 flex flex-col justify-between border border-white/15 shadow-2xl"
            style={{ backgroundColor: activeSlide.bgColor }}
          >
            <div className="space-y-3 overflow-y-auto">
              <h2 className="text-xl sm:text-3xl font-extrabold text-white">{titleEl?.content || ''}</h2>
              <div className="text-sm sm:text-base text-slate-200 whitespace-pre-line leading-relaxed">
                {bodyEl?.content || ''}
              </div>
            </div>
            <div className="text-xs text-slate-300/70 text-right">
              {activeIndex + 1} / {slides.length}
            </div>
          </div>

          <div className="flex items-center justify-center gap-6 pb-2">
            <button
              type="button"
              onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
              disabled={activeIndex === 0}
              className="h-12 px-5 rounded-full bg-white/15 text-white font-semibold flex items-center gap-1 disabled:opacity-30"
              aria-label="Previous slide"
            >
              <ChevronLeft className="w-5 h-5" /> Prev
            </button>
            <span className="text-xs font-mono text-slate-300">
              {activeIndex + 1} / {slides.length}
            </span>
            <button
              type="button"
              onClick={() => setActiveIndex((i) => Math.min(slides.length - 1, i + 1))}
              disabled={activeIndex === slides.length - 1}
              className="h-12 px-5 rounded-full bg-white/15 text-white font-semibold flex items-center gap-1 disabled:opacity-30"
              aria-label="Next slide"
            >
              Next <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
