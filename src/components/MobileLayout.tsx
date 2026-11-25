import React from 'react';
import {
  Bell,
  ChevronLeft,
  Clock,
  FolderOpen,
  Home,
  Layers,
  Menu,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { MobileSubView, MobileTab } from '../types';

interface MobileLayoutProps {
  activeTab: MobileTab;
  subView: MobileSubView;
  title: string;
  isOnline: boolean;
  unreadNotifications: number;
  toast: { type: 'info' | 'success' | 'error'; message: string } | null;
  onDismissToast: () => void;
  onSelectTab: (tab: MobileTab) => void;
  onBack: () => void;
  onOpenNotifications: () => void;
  children: React.ReactNode;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({
  activeTab,
  subView,
  title,
  isOnline,
  unreadNotifications,
  toast,
  onDismissToast,
  onSelectTab,
  onBack,
  onOpenNotifications,
  children,
}) => {
  const navItems: Array<{ id: MobileTab; label: string; icon: React.ReactNode }> = [
    { id: 'home', label: 'Home', icon: <Home className="w-5 h-5" /> },
    { id: 'library', label: 'Library', icon: <FolderOpen className="w-5 h-5" /> },
    { id: 'studios', label: 'Studios', icon: <Layers className="w-5 h-5" /> },
    { id: 'activity', label: 'Activity', icon: <Clock className="w-5 h-5" /> },
    { id: 'more', label: 'More', icon: <Menu className="w-5 h-5" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0B1120] text-slate-100 select-none">
      {/* Top App Bar */}
      <header className="pt-safe px-4 pb-3 bg-slate-900/95 border-b border-slate-800/80 backdrop-blur flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {subView !== 'none' ? (
            <button
              onClick={onBack}
              className="w-10 h-10 -ml-2 rounded-xl flex items-center justify-center text-slate-300 active:bg-slate-800"
              aria-label="Go back"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center font-bold text-sm text-white shrink-0">
              O
            </div>
          )}
          <h1 className="text-base font-semibold tracking-tight truncate">{title}</h1>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium ${
              isOnline
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
            }`}
          >
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isOnline ? 'Online' : 'Offline'}
          </span>

          <button
            onClick={onOpenNotifications}
            className="relative w-10 h-10 rounded-xl flex items-center justify-center bg-slate-800/80 text-slate-200 active:bg-slate-700"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Toast Feedback */}
      {toast && (
        <div
          onClick={onDismissToast}
          className={`mx-4 mt-2 px-3.5 py-2.5 rounded-xl text-xs font-medium border flex items-center justify-between gap-2 shrink-0 ${
            toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/40 text-rose-200'
              : toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-slate-800/95 border-slate-700 text-slate-200'
          }`}
        >
          <span className="leading-snug">{toast.message}</span>
          <span className="text-[10px] opacity-70 shrink-0">Tap to close</span>
        </div>
      )}

      {/* Main Scrollable Viewport */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">{children}</main>

      {/* Bottom Tab Bar */}
      <nav className="pb-safe bg-slate-900/95 border-t border-slate-800/90 px-2 pt-1.5 flex items-center justify-around shrink-0">
        {navItems.map((item) => {
          const active = activeTab === item.id && subView === 'none';
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`flex flex-col items-center justify-center min-w-[58px] py-1.5 rounded-xl transition-colors ${
                active ? 'text-indigo-400' : 'text-slate-400 active:text-slate-200'
              }`}
            >
              {item.icon}
              <span className="text-[11px] font-medium mt-0.5">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
