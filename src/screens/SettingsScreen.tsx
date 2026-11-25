import React, { useEffect, useState } from 'react';
import { Bell, Key, LogOut, Server, Shield, Trash2 } from 'lucide-react';
import { DEFAULT_URLS, envManager } from '../config/env';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/apiClient';
import { offlineStore } from '../services/offlineStore';
import { AppEnvironment, NotificationPreferences } from '../types';

export const SettingsScreen: React.FC<{ onToast: (type: 'info' | 'success' | 'error', message: string) => void }> = ({
  onToast,
}) => {
  const { user, isOnline, logout, updateLocalUser } = useAuth();
  const [env, setEnv] = useState<AppEnvironment>(envManager.getEnvironment());
  const [apiUrl, setApiUrl] = useState(envManager.getApiBaseUrl());
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    in_app_admin: true,
    in_app_team: true,
    in_app_workflow: true,
    email_digest: false,
  });
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!isOnline) return;
    apiClient.getNotificationPreferences().then(setPrefs).catch(() => {});
    apiClient.getApiKeys().then(setApiKeys).catch(() => {});
  }, [isOnline]);

  const handleApplyServer = async () => {
    try {
      const normalized = await envManager.setConfiguration(env, apiUrl);
      setApiUrl(normalized);
      const health = await apiClient.getHealth(normalized);
      onToast('success', `Backend reachable (${health.status}): ${normalized}`);
    } catch (err: any) {
      onToast('error', err?.message || 'Invalid or unreachable backend URL');
    }
  };

  const handleTogglePref = async (key: keyof NotificationPreferences) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      await apiClient.updateNotificationPreferences({ [key]: next[key] });
      onToast('success', 'Notification preferences saved.');
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to save preferences');
    }
  };

  const handleToggleAiConsent = async () => {
    const nextVal = !user?.aiConsent;
    try {
      if (nextVal) {
        await apiClient.grantConsent({ ai_consent: true });
      } else {
        await apiClient.withdrawConsent('ai_processing');
      }
      await updateLocalUser({ aiConsent: nextVal });
      onToast('success', `AI Processing consent ${nextVal ? 'enabled' : 'withdrawn'}.`);
    } catch (err: any) {
      onToast('error', err?.message || 'Consent update failed');
    }
  };

  return (
    <div className="space-y-4 pb-6">
      {/* API Environment */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
          <Server className="w-4 h-4 text-cyan-400" /> Shared Backend Environment
        </h3>
        <div className="grid grid-cols-3 gap-1.5">
          {(['production', 'staging', 'development'] as AppEnvironment[]).map((item) => (
            <button
              key={item}
              onClick={() => {
                setEnv(item);
                setApiUrl(DEFAULT_URLS[item]);
              }}
              className={`py-2 rounded-xl text-xs font-medium capitalize border ${
                env === item
                  ? 'bg-cyan-500/20 border-cyan-500 text-cyan-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        <input
          type="url"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono"
        />
        <button onClick={handleApplyServer} className="w-full h-10 rounded-xl bg-slate-800 text-xs font-semibold">
          Save &amp; Verify HTTPS Endpoint
        </button>
      </div>

      {/* Notification Preferences */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2.5">
        <h3 className="text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
          <Bell className="w-4 h-4 text-indigo-400" /> Notification Preferences
        </h3>
        {(
          [
            ['in_app_workflow', 'Workflow & Job Alerts'],
            ['in_app_admin', 'Admin Announcements'],
            ['in_app_team', 'Workspace Activity'],
            ['email_digest', 'Email Digest'],
          ] as Array<[keyof NotificationPreferences, string]>
        ).map(([key, label]) => (
          <label key={key} className="flex items-center justify-between text-xs py-1">
            <span>{label}</span>
            <input
              type="checkbox"
              disabled={!isOnline}
              checked={prefs[key]}
              onChange={() => handleTogglePref(key)}
            />
          </label>
        ))}
      </div>

      {/* Privacy & Consents */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2.5">
        <h3 className="text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
          <Shield className="w-4 h-4 text-emerald-400" /> Privacy &amp; Security
        </h3>
        <label className="flex items-center justify-between text-xs py-1">
          <span>AI Document Processing Consent</span>
          <input type="checkbox" disabled={!isOnline} checked={Boolean(user?.aiConsent)} onChange={handleToggleAiConsent} />
        </label>
        <button
          onClick={async () => {
            await offlineStore.clearUserCaches();
            onToast('success', 'Offline document cache cleared.');
          }}
          className="w-full h-10 rounded-xl bg-slate-800 text-xs font-semibold"
        >
          Clear Offline Metadata Cache
        </button>
      </div>

      {/* Developer API Keys */}
      {isOnline && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2.5">
          <h3 className="text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
            <Key className="w-4 h-4 text-amber-400" /> Developer API Keys ({apiKeys.length})
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Mobile Automation Key"
              className="flex-1 h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs"
            />
            <button
              onClick={async () => {
                if (!newKeyName.trim()) return;
                try {
                  const created = await apiClient.createApiKey(newKeyName.trim());
                  setNewKeyName('');
                  setApiKeys(await apiClient.getApiKeys());
                  onToast('success', `Key created: ${created.key_prefix || 'saved'}`);
                } catch (err: any) {
                  onToast('error', err?.message || 'Key creation failed');
                }
              }}
              className="px-3.5 h-10 rounded-xl bg-indigo-600 text-xs font-semibold text-white"
            >
              Create
            </button>
          </div>
          {apiKeys.map((k) => (
            <div key={k.id} className="flex items-center justify-between text-xs bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <span className="truncate">{k.name}</span>
              <button
                onClick={async () => {
                  await apiClient.revokeApiKey(k.id);
                  setApiKeys(await apiClient.getApiKeys());
                }}
                className="text-rose-400"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Session & Danger Zone */}
      <div className="space-y-2">
        <button
          onClick={logout}
          className="w-full h-11 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full h-11 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Delete Account Permanently
          </button>
        ) : (
          <div className="bg-rose-950/70 border border-rose-500/40 rounded-2xl p-3 space-y-2 text-xs">
            <p className="text-rose-200">This permanently purges your account and documents on the shared backend.</p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    await apiClient.deleteAccount();
                    await logout();
                  } catch (err: any) {
                    onToast('error', err?.message || 'Deletion failed');
                  }
                }}
                className="flex-1 h-10 rounded-xl bg-rose-600 text-white font-semibold"
              >
                Confirm Purge
              </button>
              <button onClick={() => setConfirmDelete(false)} className="flex-1 h-10 rounded-xl bg-slate-800">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
