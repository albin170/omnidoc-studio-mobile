import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';

export interface ConfirmDialogProps {
  open?: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible, touch-friendly modal confirmation dialog for destructive or high-impact actions.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open = true,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const messageId = useId();
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    cancelBtnRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 px-4 pb-safe pt-6"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
              danger
                ? 'bg-rose-500/12 border-rose-500/30 text-rose-400'
                : 'bg-indigo-500/12 border-indigo-500/30 text-indigo-400'
            }`}
          >
            {danger ? <AlertTriangle className="w-5 h-5" /> : <HelpCircle className="w-5 h-5" />}
          </div>

          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-100 leading-snug">
              {title}
            </h2>
            <p id={messageId} className="mt-1 text-xs leading-relaxed text-slate-400">
              {message}
            </p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="w-9 h-9 -mt-1 -mr-1 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-200 active:bg-slate-800 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            ref={cancelBtnRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
              danger
                ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700'
                : 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700'
            }`}
          >
            {busy ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
