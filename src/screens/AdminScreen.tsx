import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, Search, ShieldAlert, UserCheck, UserX } from 'lucide-react';
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
        <button onClick={loadAdminData} className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {telemetry && (
        <div className="grid grid-cols-2 gap-2.5 text-center">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <p className="text-lg font-bold">{telemetry.total_users}</p>
            <p className="text-[11px] text-slate-400">Users ({telemetry.active_users} active)</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <p className="text-lg font-bold">{telemetry.total_documents}</p>
            <p className="text-[11px] text-slate-400">{formatFileSize(telemetry.total_storage_bytes)}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
            <p className="text-lg font-bold">{telemetry.total_jobs}</p>
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
        <input
          type="text"
          value={banner}
          onChange={(e) => setBanner(e.target.value)}
          placeholder="System-wide banner text"
          className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs"
        />
        <label className="flex items-center justify-between text-xs">
          <span>Maintenance Mode</span>
          <input type="checkbox" checked={maintenance} onChange={(e) => setMaintenance(e.target.checked)} />
        </label>
        <button
          onClick={async () => {
            try {
              await apiClient.updateAdminUiConfig({ announcement_banner: banner, maintenance_mode: maintenance });
              onToast('success', 'Global UI configuration updated.');
            } catch (err: any) {
              onToast('error', err?.message || 'Update failed');
            }
          }}
          className="w-full h-10 rounded-xl bg-amber-600 text-xs font-semibold text-white"
        >
          Publish System Config
        </button>
      </div>

      {/* User Directory */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter users by email..."
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-900 border border-slate-800 text-xs"
          />
        </div>

        {users.map((u) => (
          <div key={u.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate">{u.email}</p>
              <p className="text-[11px] text-slate-400">
                {u.role} · {u.plan_tier} · {u.documents_count} docs
              </p>
            </div>
            {u.is_active ? (
              <button
                onClick={async () => {
                  await apiClient.suspendUser(u.id, 'Suspended from mobile admin console');
                  await loadAdminData();
                }}
                className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 text-[11px] flex items-center gap-1"
              >
                <UserX className="w-3.5 h-3.5" /> Suspend
              </button>
            ) : (
              <button
                onClick={async () => {
                  await apiClient.reactivateUser(u.id);
                  await loadAdminData();
                }}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-[11px] flex items-center gap-1"
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
    </div>
  );
};
