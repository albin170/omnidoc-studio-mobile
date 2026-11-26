import React, { useState } from 'react';
import { Bell, ChevronRight, Clock, Layers, LogOut, Settings, ShieldAlert, Sparkles } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { MobileSubView } from '../types';

interface MoreScreenProps {
  unreadCount: number;
  onOpenSubView: (view: MobileSubView) => void;
}

export const MoreScreen: React.FC<MoreScreenProps> = ({ unreadCount, onOpenSubView }) => {
  const { user, isAdmin, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const items: Array<{ id: MobileSubView; title: string; subtitle: string; icon: React.ReactNode; badge?: string }> = [
    {
      id: 'studios_hub',
      title: 'All Document Studios',
      subtitle: 'Word, PowerPoint, Excel Sheets, PDF & Converter',
      icon: <Layers className="w-5 h-5 text-indigo-400" />,
    },
    {
      id: 'history',
      title: 'Document History & Jobs',
      subtitle: 'Cloud processing jobs & local activity log',
      icon: <Clock className="w-5 h-5 text-emerald-400" />,
    },
    {
      id: 'notifications',
      title: 'Notifications & Support',
      subtitle: 'Alerts, system announcements & support inbox',
      icon: <Bell className="w-5 h-5 text-cyan-400" />,
      badge: unreadCount > 0 ? String(unreadCount) : undefined,
    },
    {
      id: 'settings',
      title: 'Account & App Settings',
      subtitle: 'API environment, security, API keys & consents',
      icon: <Settings className="w-5 h-5 text-slate-300" />,
    },
    {
      id: 'ai_assistant',
      title: 'OmniCore AI Assistant',
      subtitle: 'RAG document Q&A & autonomous agent runs',
      icon: <Sparkles className="w-5 h-5 text-violet-400" />,
    },
  ];

  if (isAdmin) {
    items.push({
      id: 'admin',
      title: 'Administrator Console',
      subtitle: 'Telemetry, user management, announcements & audit logs',
      icon: <ShieldAlert className="w-5 h-5 text-amber-400" />,
      badge: user?.role.toUpperCase(),
    });
  }

  return (
    <div className="space-y-3 pb-6">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpenSubView(item.id)}
          className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 text-left active:bg-slate-800"
        >
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">{item.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-100">{item.title}</p>
              {item.badge && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300">
                  {item.badge}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate">{item.subtitle}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-500 shrink-0" />
        </button>
      ))}

      <button
        type="button"
        onClick={() => setConfirmLogout(true)}
        className="w-full h-12 rounded-2xl bg-rose-950/50 border border-rose-500/30 text-rose-300 font-semibold text-sm flex items-center justify-center gap-2 mt-4"
      >
        <LogOut className="w-4 h-4" /> Sign Out &amp; Clear Secure Vault
      </button>

      <ConfirmDialog
        open={confirmLogout}
        title="Sign Out of OmniDoc?"
        message="This clears your local encrypted session token and offline cache."
        confirmLabel="Sign Out"
        danger
        onConfirm={() => {
          setConfirmLogout(false);
          logout();
        }}
        onCancel={() => setConfirmLogout(false)}
      />
    </div>
  );
};
