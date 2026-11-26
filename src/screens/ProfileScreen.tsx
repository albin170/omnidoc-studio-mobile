import React, { useEffect, useState } from 'react';
import {
  Bell,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Key,
  KeyRound,
  Layers,
  LogOut,
  Save,
  Settings,
  ShieldAlert,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/apiClient';
import { saveFileToDevice } from '../services/nativeBridge';
import { MobileSubView } from '../types';

interface ProfileScreenProps {
  unreadCount?: number;
  onOpenSubView: (view: MobileSubView) => void;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ unreadCount = 0, onOpenSubView, onToast }) => {
  const { user, entitlements, isAdmin, isOnline, updateLocalUser, logout } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [subscription, setSubscription] = useState<any>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    if (user?.fullName) setFullName(user.fullName);
  }, [user?.fullName]);

  useEffect(() => {
    if (isOnline) {
      apiClient.getSubscription().then(setSubscription).catch(() => {});
    }
  }, [isOnline]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    setBusy(true);
    try {
      const updated = await apiClient.updateProfile(fullName.trim());
      await updateLocalUser({ fullName: updated.full_name });
      onToast('success', 'Profile updated.');
    } catch (err: any) {
      onToast('error', err?.message || 'Profile update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiClient.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      onToast('success', res.message || 'Password updated and token rotated.');
    } catch (err: any) {
      onToast('error', err?.message || 'Password change failed');
    } finally {
      setBusy(false);
    }
  };

  const handleExportArchive = async () => {
    setBusy(true);
    try {
      const archive = await apiClient.exportMyData();
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
      const saved = await saveFileToDevice(blob, `omnidoc_export_${user?.userId || 'user'}.json`);
      onToast('success', `GDPR export saved to ${saved.path}`);
    } catch (err: any) {
      onToast('error', err?.message || 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const quickLinks: Array<{
    id: MobileSubView;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    badge?: string;
  }> = [
    {
      id: 'settings',
      title: 'Account Settings',
      subtitle: 'Backend endpoint, notification prefs, privacy & account deletion',
      icon: <Settings className="w-5 h-5 text-slate-300" />,
    },
    {
      id: 'notifications',
      title: 'Notifications & Support',
      subtitle: 'Alerts, active announcements & administrator support',
      icon: <Bell className="w-5 h-5 text-cyan-400" />,
      badge: unreadCount > 0 ? String(unreadCount) : undefined,
    },
    {
      id: 'history',
      title: 'Document History & Jobs',
      subtitle: 'Cloud processing jobs, approvals & device activity log',
      icon: <Clock className="w-5 h-5 text-indigo-400" />,
    },
    {
      id: 'studios_hub',
      title: 'All Document Studios',
      subtitle: 'Word, PowerPoint, Excel Sheets, PDF, Converter & AI',
      icon: <Layers className="w-5 h-5 text-emerald-400" />,
    },
    {
      id: 'ai_assistant',
      title: 'OmniCore AI Assistant',
      subtitle: 'Document RAG Q&A & autonomous workflow agents',
      icon: <Sparkles className="w-5 h-5 text-violet-400" />,
    },
    {
      id: 'settings',
      title: 'Developer API Keys',
      subtitle: 'Create & revoke personal REST API keys in Settings',
      icon: <Key className="w-5 h-5 text-amber-400" />,
    },
  ];

  if (isAdmin) {
    quickLinks.push({
      id: 'admin',
      title: 'Admin Console',
      subtitle: 'Server-verified telemetry, user management & audit logs',
      icon: <ShieldAlert className="w-5 h-5 text-amber-400" />,
      badge: user?.role.toUpperCase(),
    });
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Identity Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2.5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <UserCheck className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold text-slate-100 truncate">{user?.fullName}</p>
            <p className="text-xs text-slate-400 truncate">{user?.email}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-400">
          <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800">
            Role: <strong className="text-slate-200 uppercase">{user?.role}</strong>
          </div>
          <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800 truncate">
            Org ID: <strong className="text-slate-200 font-mono">{user?.orgId?.slice(0, 8)}…</strong>
          </div>
        </div>
      </div>

      {/* Subscription Card */}
      {(subscription || entitlements) && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <CreditCard className="w-5 h-5 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100 truncate">
                {subscription?.plan_name || entitlements?.plan_name || 'Plan'}
              </p>
              <p className="text-xs text-slate-400 truncate">
                Status: {subscription?.status || (entitlements?.is_active ? 'active' : 'inactive')} · Support:{' '}
                {subscription?.support_level || entitlements?.support_level || 'standard'}
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold uppercase px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-300 shrink-0">
            {subscription?.plan_slug || entitlements?.plan_slug || user?.planTier}
          </span>
        </div>
      )}

      {/* Account Hub Navigation Links */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Account &amp; Workspace Hub</h3>
        {quickLinks.map((link, idx) => (
          <button
            key={`${link.id}-${idx}`}
            type="button"
            onClick={() => onOpenSubView(link.id)}
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex items-center gap-3 text-left active:bg-slate-800"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0">
              {link.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-100 truncate">{link.title}</p>
                {link.badge && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 shrink-0">
                    {link.badge}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate">{link.subtitle}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
          </button>
        ))}
      </div>

      {/* Edit Display Name */}
      <form onSubmit={handleSaveName} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <label htmlFor="profile-full-name" className="block text-xs font-semibold uppercase text-slate-400">
          Edit Display Name
        </label>
        <input
          id="profile-full-name"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !isOnline}
          className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Save className="w-4 h-4" /> Save Profile
        </button>
      </form>

      {/* Change Password */}
      <form onSubmit={handleChangePassword} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-amber-400" /> Change Password
        </h3>
        <div>
          <label htmlFor="profile-current-password" className="sr-only">
            Current password
          </label>
          <input
            id="profile-current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="profile-new-password" className="sr-only">
            New password
          </label>
          <input
            id="profile-new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 8 chars)"
            className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !isOnline}
          className="w-full h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white disabled:opacity-40"
        >
          Update Password &amp; Rotate Token
        </button>
      </form>

      {/* GDPR Export & Sign Out */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={handleExportArchive}
          disabled={busy || !isOnline}
          className="w-full h-11 rounded-2xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-100 flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Download className="w-4 h-4 text-emerald-400" /> Export My Data Archive (SHA-256 JSON)
        </button>

        <button
          type="button"
          onClick={() => setConfirmLogout(true)}
          className="w-full h-11 rounded-2xl bg-rose-950/50 border border-rose-500/35 text-rose-300 font-semibold text-xs flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" /> Sign Out &amp; Clear Secure Vault
        </button>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title="Sign Out of OmniDoc?"
        message="This clears your local encrypted session token and offline document cache on this device."
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
