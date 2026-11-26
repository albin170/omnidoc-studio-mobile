import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, Search, ShieldAlert, UserCheck, UserX } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { formatFileSize } from '../engines/formatDetector';
import { apiClient } from '../services/apiClient';

export const AdminScreen: React.FC<{ onToast: (type: 'info' | 'success' | 'error', message: string) => void }> = ({
  onToast,
}) => {
  const { isAdmin, isOnline } = useAuth();
  const [telemetry, setTelemetry] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [banner, setBanner] = useState('');
  const [maintenance, setMaintenance] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<any | null>(null);
  const [suspending, setSuspending] = useState(false);

  const loadAdminData = useCallback(async () => {
    if (!isAdmin || !isOnline) return;
    setLoading(true);
    try {
      const [tel, usr, cfg, audit] = await Promise.all([
        apiClient.getAdminTelemetry(),
        apiClient.getAdminUsers(search),
        apiClient.getAdminUiConfig().catch(() => null),
        apiClient.getAdminAuditLogs(20).catch(() => []),
      ]);
      setTelemetry(tel);
      setUsers(usr);
      setLogs(audit);
      if (cfg) {
        setBanner(cfg.announcement_banner || '');
        setMaintenance(Boolean(cfg.maintenance_mode));
      }
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to load admin telemetry');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isOnline, onToast, search]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  const handleConfirmSuspend = async () => {
    if (!suspendTarget) return;
    setSuspending(true);
    try {
      await apiClient.suspendUser(suspendTarget.id, 'Suspended from mobile admin console');
      onToast('success', `Suspended ${suspendTarget.email}.`);
      setSuspendTarget(null);
      await loadAdminData();
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to suspend user');
    } finally {
      setSuspending(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-rose-950/50 border border-rose-500/40 rounded-2xl p-6 text-center space-y-2">
        <ShieldAlert className="w-10 h-10 mx-auto text-rose-400" />
        <p className="text-sm font-bold text-rose-200">403 Forbidden — Administrator Privileges Required</p>
        <p className="text-xs text-rose-300/80">
          This route is restricted to server-verified administrator and superadministrator accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold flex items-center gap-2 text-amber-300">
          <Activity className="w-4 h-4" /> Platform Telemetry
        </h2>
        <button
          type="button"
          onClick={loadAdminData}
          aria-label="Refresh admin telemetry"
          className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-200"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {telemetry && (
        <div className="grid grid-cols-2 gap-2.5 text-center">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <p className="text-lg font-bold text-slate-100">{telemetry.total_users}</p>
            <p className="text-[11px] text-slate-400">Users ({telemetry.active_users} active)</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <p className="text-lg font-bold text-slate-100">{telemetry.total_documents}</p>
            <p className="text-[11px] text-slate-400">{formatFileSize(telemetry.total_storage_bytes)}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <p className="text-lg font-bold text-slate-100">{telemetry.total_jobs}</p>
            <p className="text-[11px] text-slate-400">Jobs ({telemetry.failed_jobs} failed)</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <p className="text-lg font-bold uppercase text-cyan-300">{telemetry.environment}</p>
            <p className="text-[11px] text-slate-400">Backend Env</p>
          </div>
        </div>
      )}

      {/* Global UI Banner & Maintenance */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
        <h3 className="text-xs font-semibold text-slate-300">Global Announcement &amp; Maintenance</h3>
        <div>
          <label htmlFor="admin-banner" className="sr-only">
            System-wide banner text
          </label>
          <input
            id="admin-banner"
            name="announcementBanner"
            type="text"
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
            placeholder="System-wide banner text"
            className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <label htmlFor="admin-maintenance" className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
          <span>Maintenance Mode</span>
          <input
            id="admin-maintenance"
            name="maintenanceMode"
            type="checkbox"
            checked={maintenance}
            onChange={(e) => setMaintenance(e.target.checked)}
          />
        </label>
        <button
          type="button"
          onClick={async () => {
            try {
              await apiClient.updateAdminUiConfig({ announcement_banner: banner, maintenance_mode: maintenance });
              onToast('success', 'Global UI configuration updated.');
            } catch (err: any) {
              onToast('error', err?.message || 'Update failed');
            }
          }}
          className="w-full h-10 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white"
        >
          Publish System Config
        </button>
      </div>

      {/* User Directory */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
          <label htmlFor="admin-user-search" className="sr-only">
            Filter users by email
          </label>
          <input
            id="admin-user-search"
            name="userSearch"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter users by email..."
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {users.map((u) => (
          <div key={u.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-100 truncate">{u.email}</p>
              <p className="text-[11px] text-slate-400">
                {u.role} · {u.plan_tier} · {u.documents_count} docs
              </p>
            </div>
            {u.is_active ? (
              <button
                type="button"
                onClick={() => setSuspendTarget(u)}
                className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 text-[11px] flex items-center gap-1 shrink-0"
              >
                <UserX className="w-3.5 h-3.5" /> Suspend
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await apiClient.reactivateUser(u.id);
                    onToast('success', `Reactivated ${u.email}.`);
                    await loadAdminData();
                  } catch (err: any) {
                    onToast('error', err?.message || 'Failed to reactivate user');
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-[11px] flex items-center gap-1 shrink-0"
              >
                <UserCheck className="w-3.5 h-3.5" /> Activate
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Recent Audit Events */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
        <h3 className="text-xs font-semibold text-slate-300">Recent Audit Logs</h3>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {logs.map((ev, idx) => (
            <div key={ev.id || idx} className="text-[11px] border-b border-slate-800/70 pb-1.5">
              <span className="font-mono text-cyan-300">{ev.action}</span> ·{' '}
              <span className="text-slate-400">{ev.target_type}</span>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(suspendTarget)}
        title="Suspend User Account?"
        message={
          suspendTarget
            ? `Suspend ${suspendTarget.email}? They will immediately lose access to the OmniDoc backend until reactivated.`
            : ''
        }
        confirmLabel="Suspend User"
        danger
        busy={suspending}
        onConfirm={handleConfirmSuspend}
        onCancel={() => !suspending && setSuspendTarget(null)}
      />
    </div>
  );
};
