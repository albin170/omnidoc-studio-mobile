import React from 'react';
import {
  ArrowLeftRight,
  Bell,
  ChevronLeft,
  FileText,
  FolderOpen,
  Home,
  User,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { MobileSubView, MobileTab } from '../types';

export interface MobileLayoutProps {
  activeTab: MobileTab;
  subView: MobileSubView;
  title: string;
  subtitle?: string;
  isOnline: boolean;
  unreadNotifications: number;
  toast: { type: 'info' | 'success' | 'error'; message: string } | null;
  onDismissToast: () => void;
  onSelectTab: (tab: MobileTab) => void;
  onBack: () => void;
  onOpenNotifications: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{ id: MobileTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'convert', label: 'Convert', icon: ArrowLeftRight },
  { id: 'pdf', label: 'PDF', icon: FileText },
  { id: 'docs', label: 'Docs', icon: FolderOpen },
  { id: 'profile', label: 'Profile', icon: User },
];

export const MobileLayout: React.FC<MobileLayoutProps> = ({
  activeTab,
  subView,
  title,
  subtitle,
  isOnline,
  unreadNotifications,
  toast,
  onDismissToast,
  onSelectTab,
  onBack,
  onOpenNotifications,
  children,
}) => {
  return (
    <div className="flex flex-col h-full bg-[#0B1120] text-slate-100 select-none">
      {/* Top App Bar */}
      <header className="pt-safe px-4 pb-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {subView !== 'none' ? (
            <button
              type="button"
              onClick={onBack}
              className="min-w-[44px] min-h-[44px] -ml-2 rounded-xl flex items-center justify-center text-slate-300 hover:text-white active:bg-slate-800 transition-colors"
              aria-label="Go back"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : (
            <div
              aria-hidden="true"
              className="w-8 h-8 rounded-lg bg-indigo-600 border border-indigo-400/25 flex items-center justify-center shrink-0"
            >
              <FileText className="w-4 h-4 text-white" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-slate-100 tracking-tight truncate leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border ${
              isOnline
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/25'
                : 'bg-amber-950/60 text-amber-300 border-amber-500/30'
            }`}
          >
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span>{isOnline ? 'Online' : 'Offline'}</span>
          </span>

          <button
            type="button"
            onClick={onOpenNotifications}
            className="relative min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center bg-slate-900 border border-slate-800 text-slate-200 active:bg-slate-800 transition-colors"
            aria-label={unreadNotifications > 0 ? `Notifications (${unreadNotifications} unread)` : 'Notifications'}
          >
            <Bell className="w-[18px] h-[18px]" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Toast Feedback */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`mx-4 mt-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium border flex items-center justify-between gap-2 shrink-0 ${
            toast.type === 'error'
              ? 'bg-rose-950 border-rose-500/40 text-rose-100'
              : toast.type === 'success'
              ? 'bg-emerald-950 border-emerald-500/40 text-emerald-100'
              : 'bg-slate-900 border-slate-700 text-slate-200'
          }`}
        >
          <span className="leading-snug flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={onDismissToast}
            aria-label="Dismiss notification"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-current opacity-75 hover:opacity-100 active:bg-black/20 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Scrollable Viewport */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">{children}</main>

      {/* Bottom Tab Bar */}
      <nav
        aria-label="Primary navigation"
        className="pb-safe bg-slate-950 border-t border-slate-800 px-1.5 pt-1.5 grid grid-cols-5 gap-1 shrink-0"
      >
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id && subView === 'none';
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`min-h-[48px] flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-colors ${
                active
                  ? 'bg-indigo-500/12 text-indigo-400'
                  : 'text-slate-400 hover:text-slate-200 active:bg-slate-900'
              }`}
            >
              <Icon className="w-[18px] h-[18px]" />
              <span className="text-[11px] font-medium mt-1 leading-none">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
