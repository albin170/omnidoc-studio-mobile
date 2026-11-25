import React, { useEffect, useState } from 'react';
import { CreditCard, Download, KeyRound, Save, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/apiClient';
import { saveFileToDevice } from '../services/nativeBridge';

export const ProfileScreen: React.FC<{ onToast: (type: 'info' | 'success' | 'error', message: string) => void }> = ({
  onToast,
}) => {
  const { user, isOnline, updateLocalUser } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [subscription, setSubscription] = useState<any>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="space-y-4 pb-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center">
            <UserCheck className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold truncate">{user?.fullName}</p>
            <p className="text-xs text-slate-400 truncate">{user?.email}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2 text-[11px] text-slate-400">
          <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800">
            Role: <strong className="text-slate-200 uppercase">{user?.role}</strong>
          </div>
          <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800 truncate">
            Org ID: <strong className="text-slate-200 font-mono">{user?.orgId?.slice(0, 8)}…</strong>
          </div>
        </div>
      </div>

      {subscription && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-cyan-400" />
            <div>
              <p className="text-sm font-semibold">{subscription.plan_name}</p>
              <p className="text-xs text-slate-400">
                Status: {subscription.status} · Support: {subscription.support_level}
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold uppercase px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-300">
            {subscription.plan_slug}
          </span>
        </div>
      )}

      <form onSubmit={handleSaveName} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase text-slate-400">Edit Display Name</h3>
        <input
          type="text"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !isOnline}
          className="w-full h-11 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Save className="w-4 h-4" /> Save Profile
        </button>
      </form>

      <form onSubmit={handleChangePassword} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-amber-400" /> Change Password
        </h3>
        <input
          type="password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm"
        />
        <input
          type="password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (min 8 chars)"
          className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !isOnline}
          className="w-full h-11 rounded-xl bg-slate-800 text-xs font-semibold text-white disabled:opacity-40"
        >
          Update Password &amp; Rotate Token
        </button>
      </form>

      <button
        onClick={handleExportArchive}
        disabled={busy || !isOnline}
        className="w-full h-11 rounded-2xl bg-slate-900 border border-slate-800 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <Download className="w-4 h-4 text-emerald-400" /> Export My Data Archive (SHA-256 JSON)
      </button>
    </div>
  );
};
