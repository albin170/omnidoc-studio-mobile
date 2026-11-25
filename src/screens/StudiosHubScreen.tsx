import React from 'react';
import { ChevronRight, FileSpreadsheet, FileText, Repeat, Sparkles } from 'lucide-react';
import { MobileSubView } from '../types';

interface StudiosHubScreenProps {
  onOpenSubView: (view: MobileSubView) => void;
}

export const StudiosHubScreen: React.FC<StudiosHubScreenProps> = ({ onOpenSubView }) => {
  const studios: Array<{
    id: MobileSubView;
    title: string;
    subtitle: string;
    badge: string;
    icon: React.ReactNode;
    accent: string;
  }> = [
    {
      id: 'pdf_studio',
      title: 'PDF Studio',
      subtitle: 'View pages, merge, split, rotate, watermark, extract text & scan camera photos to PDF.',
      badge: 'Offline + Cloud',
      icon: <FileText className="w-6 h-6 text-rose-400" />,
      accent: 'border-rose-500/30 bg-rose-500/10',
    },
    {
      id: 'conversion_studio',
      title: 'Conversion Studio',
      subtitle: 'Convert PDF, DOCX, PPTX, XLSX, CSV, PNG, JPG, WEBP, TXT, HTML & MD on-device or via backend.',
      badge: '11 Formats',
      icon: <Repeat className="w-6 h-6 text-amber-400" />,
      accent: 'border-amber-500/30 bg-amber-500/10',
    },
    {
      id: 'sheets_studio',
      title: 'Excel Sheets Studio',
      subtitle: 'Edit spreadsheets with formula bar (=SUM, =AVERAGE, =IF), sort, deduplicate & export XLSX/CSV/PDF.',
      badge: 'Formula Engine',
      icon: <FileSpreadsheet className="w-6 h-6 text-emerald-400" />,
      accent: 'border-emerald-500/30 bg-emerald-500/10',
    },
    {
      id: 'ai_assistant',
      title: 'AI Document Assistant',
      subtitle: 'Ask grounded RAG questions across indexed vault documents or execute OmniCore agents.',
      badge: 'RAG + Agents',
      icon: <Sparkles className="w-6 h-6 text-violet-400" />,
      accent: 'border-violet-500/30 bg-violet-500/10',
    },
  ];

  return (
    <div className="space-y-3 pb-4">
      <p className="text-xs text-slate-400">
        Dedicated mobile-optimized studios powered by OmniDoc engines and shared cloud APIs.
      </p>
      {studios.map((s) => (
        <button
          key={s.id}
          onClick={() => onOpenSubView(s.id)}
          className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 text-left active:bg-slate-800"
        >
          <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${s.accent}`}>
            {s.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold">{s.title}</h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                {s.badge}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{s.subtitle}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-500 shrink-0" />
        </button>
      ))}
    </div>
  );
};
