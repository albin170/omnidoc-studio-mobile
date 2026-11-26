import React, { useEffect, useState } from 'react';
import { Bell, Copy, Key, LogOut, Server, Shield, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
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
  const [createdKeySecret, setCreatedKeySecret] = useState<string | null>(null);

  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [revokeKeyTarget, setRevokeKeyTarget] = useState<any | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

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

  const handleConfirmClearCache = async () => {
    setConfirmBusy(true);
    try {
      await offlineStore.clearUserCaches();
      setConfirmClearCache(false);
      onToast('success', 'Offline document metadata cache cleared.');
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    setConfirmBusy(true);
    try {
      await apiClient.deleteAccount();
      setConfirmDeleteAccount(false);
      await logout();
    } catch (err: any) {
      onToast('error', err?.message || 'Deletion failed');
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleConfirmRevokeKey = async () => {
    if (!revokeKeyTarget) return;
    setConfirmBusy(true);
    try {
      await apiClient.revokeApiKey(revokeKeyTarget.id);
      setApiKeys(await apiClient.getApiKeys());
      onToast('success', `Revoked API key "${revokeKeyTarget.name}".`);
      setRevokeKeyTarget(null);
    } catch (err: any) {
      onToast('error', err?.message || 'Revoke failed');
    } finally {
      setConfirmBusy(false);
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
              type="button"
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
        <div>
          <label htmlFor="settings-api-url" className="block text-[11px] text-slate-400 mb-1">
            HTTPS Endpoint URL
          </label>
          <input
            id="settings-api-url"
            name="apiUrl"
            type="url"
            autoComplete="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={handleApplyServer}
          className="w-full h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
        >
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
          <label key={key} htmlFor={`pref-${key}`} className="flex items-center justify-between text-xs py-1 text-slate-200 cursor-pointer">
            <span>{label}</span>
            <input
              id={`pref-${key}`}
              name={key}
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
        <label htmlFor="settings-ai-consent" className="flex items-center justify-between text-xs py-1 text-slate-200 cursor-pointer">
          <span>AI Document Processing Consent</span>
          <input
            id="settings-ai-consent"
            name="aiConsent"
            type="checkbox"
            disabled={!isOnline}
            checked={Boolean(user?.aiConsent)}
            onChange={handleToggleAiConsent}
          />
        </label>
        <button
          type="button"
          onClick={() => setConfirmClearCache(true)}
          className="w-full h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100"
        >
          Clear Offline Metadata Cache
        </button>
      </div>

      {/* Developer API Keys */}
      {isOnline && (
        <div id="developer-api-keys" className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2.5">
          <h3 className="text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
            <Key className="w-4 h-4 text-amber-400" /> Developer API Keys ({apiKeys.length})
          </h3>
          <div className="flex gap-2">
            <label htmlFor="settings-new-key-name" className="sr-only">
              API Key Name
            </label>
            <input
              id="settings-new-key-name"
              name="newApiKeyName"
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Mobile Automation Key"
              className="flex-1 h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                if (!newKeyName.trim()) return;
                try {
                  const created = await apiClient.createApiKey(newKeyName.trim());
                  setNewKeyName('');
                  setApiKeys(await apiClient.getApiKeys());
                  const rawSecret = created.raw_key || created.api_key || created.key || null;
                  if (rawSecret) setCreatedKeySecret(String(rawSecret));
                  onToast('success', `Key created: ${created.key_prefix || 'saved'}`);
                } catch (err: any) {
                  onToast('error', err?.message || 'Key creation failed');
                }
              }}
              className="px-3.5 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
            >
              Create
            </button>
          </div>

          {createdKeySecret && (
            <div className="bg-emerald-950/50 border border-emerald-500/35 rounded-xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-emerald-300 font-semibold">
                <span>Copy API Key Secret (shown once)</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(createdKeySecret).catch(() => {});
                    onToast('info', 'API key copied to clipboard.');
                  }}
                  className="inline-flex items-center gap-1 text-emerald-200 underline"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
              <p className="text-[11px] font-mono text-slate-100 break-all">{createdKeySecret}</p>
            </div>
          )}

          {apiKeys.map((k) => (
            <div key={k.id} className="flex items-center justify-between text-xs bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <div className="min-w-0">
                <span className="text-slate-100 font-medium truncate block">{k.name}</span>
                {k.key_prefix && <span className="text-[10px] font-mono text-slate-500">{k.key_prefix}…</span>}
              </div>
              <button
                type="button"
                onClick={() => setRevokeKeyTarget(k)}
                className="text-rose-400 hover:text-rose-300 font-medium shrink-0 ml-2"
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
          type="button"
          onClick={logout}
          className="w-full h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100 flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>

        <button
          type="button"
          onClick={() => setConfirmDeleteAccount(true)}
          className="w-full h-11 rounded-xl bg-rose-950/50 border border-rose-500/35 text-rose-300 text-xs font-semibold flex items-center justify-center gap-2"
        >
          <Trash2 className="w-4 h-4" /> Delete Account Permanently
        </button>
      </div>

      <ConfirmDialog
        open={confirmClearCache}
        title="Clear Offline Cache?"
        message="This removes locally cached document metadata, usage snapshots, and job lists. Your cloud files remain safe."
        confirmLabel="Clear Cache"
        danger
        busy={confirmBusy}
        onConfirm={handleConfirmClearCache}
        onCancel={() => !confirmBusy && setConfirmClearCache(false)}
      />

      <ConfirmDialog
        open={Boolean(revokeKeyTarget)}
        title="Revoke Developer API Key?"
        message={
          revokeKeyTarget
            ? `Revoke "${revokeKeyTarget.name}"? Any scripts or automations using this key will immediately fail authentication.`
            : ''
        }
        confirmLabel="Revoke Key"
        danger
        busy={confirmBusy}
        onConfirm={handleConfirmRevokeKey}
        onCancel={() => !confirmBusy && setRevokeKeyTarget(null)}
      />

      <ConfirmDialog
        open={confirmDeleteAccount}
        title="Delete Account Permanently?"
        message="This permanently purges your user account, documents, projects, and API keys from the shared OmniDoc backend. This cannot be undone."
        confirmLabel="Delete Forever"
        danger
        busy={confirmBusy}
        onConfirm={handleConfirmDeleteAccount}
        onCancel={() => !confirmBusy && setConfirmDeleteAccount(false)}
      />
    </div>
  );
};
