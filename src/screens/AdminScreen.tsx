import React, { useCallback, useEffect, useState } from 'react';
import { Activity, CreditCard, RefreshCw, Search, ShieldAlert, UserCheck, UserX } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { formatFileSize } from '../engines/formatDetector';
import { apiClient, ApiError } from '../services/apiClient';
import { UserEntitlements } from '../types';

export const AdminScreen: React.FC<{ onToast: (type: 'info' | 'success' | 'error', message: string) => void }> = ({
  onToast,
}) => {
  const { isAdmin, isOnline } = useAuth();
  const [serverDenied, setServerDenied] = useState(false);
  const [verifiedAdminEmail, setVerifiedAdminEmail] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [banner, setBanner] = useState('');
  const [maintenance, setMaintenance] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<any | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [inspectingUser, setInspectingUser] = useState<any | null>(null);
  const [inspectedEntitlements, setInspectedEntitlements] = useState<UserEntitlements | null>(null);

  const loadAdminData = useCallback(async () => {
    if (!isAdmin || !isOnline) return;
    setLoading(true);
    try {
      const adminProfile = await apiClient.verifyAdminSession();
      setVerifiedAdminEmail(adminProfile?.email || null);
      setServerDenied(false);

      const [tel, usr, cfg, audit, planList] = await Promise.all([
        apiClient.getAdminTelemetry(),
        apiClient.getAdminUsers(search),
        apiClient.getAdminUiConfig().catch(() => null),
        apiClient.getAdminAuditLogs(20).catch(() => []),
        apiClient.listAdminPlans().catch(() => []),
      ]);
      setTelemetry(tel);
      setUsers(usr);
      setLogs(audit);
      setPlans(planList);
      if (cfg) {
        setBanner(cfg.announcement_banner || '');
        setMaintenance(Boolean(cfg.maintenance_mode));
      }
    } catch (err: any) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setServerDenied(true);
        return;
      }
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

  if (!isAdmin || serverDenied) {
    return (
      <div className="bg-rose-950/50 border border-rose-500/40 rounded-2xl p-6 text-center space-y-2">
        <ShieldAlert className="w-10 h-10 mx-auto text-rose-400" />
        <p className="text-sm font-bold text-rose-200">403 Forbidden — Administrator Privileges Required</p>
        <p className="text-xs text-rose-300/80">
          This route is restricted to server-verified administrator and superadministrator accounts (/admin/me).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2 text-amber-300">
            <Activity className="w-4 h-4" /> Platform Telemetry
          </h2>
          {verifiedAdminEmail && (
            <p className="text-[10px] text-emerald-400">Server-verified session: {verifiedAdminEmail}</p>
          )}
        </div>
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

      {/* Active Subscription Plans Summary */}
      {plans.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
          <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5 text-cyan-400" /> Subscription Plans ({plans.length})
          </h3>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {plans.map((p) => (
              <div key={p.id || p.slug} className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 shrink-0 text-[11px]">
                <p className="font-semibold text-slate-100">{p.name}</p>
                <p className="text-slate-400 uppercase font-mono">{p.slug}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* User Directory, Subscription Tier & Entitlements */}
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
          <div key={u.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-100 truncate">{u.email}</p>
                <p className="text-[11px] text-slate-400">
                  {u.role} · {u.plan_tier} · {u.documents_count} docs
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const ent = await apiClient.getAdminUserEntitlements(u.id);
                      setInspectingUser(u);
                      setInspectedEntitlements(ent);
                    } catch (err: any) {
                      onToast('error', err?.message || 'Failed to load entitlements');
                    }
                  }}
                  className="px-2 py-1.5 rounded-lg bg-slate-800 text-cyan-300 text-[11px]"
                >
                  Entitlements
                </button>
                {u.is_active ? (
                  <button
                    type="button"
                    onClick={() => setSuspendTarget(u)}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 text-[11px] flex items-center gap-1"
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
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-[11px] flex items-center gap-1"
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Activate
                  </button>
                )}
              </div>
            </div>

            {u.org_id && (
              <div className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-slate-800/70">
                <span className="text-slate-400">Org Subscription Tier:</span>
                <select
                  aria-label={`Subscription tier for ${u.email}`}
                  defaultValue={u.plan_tier || 'free'}
                  onChange={async (e) => {
                    try {
                      await apiClient.updateOrgSubscription(u.org_id, e.target.value);
                      onToast('success', `Updated org plan tier to ${e.target.value}.`);
                      await loadAdminData();
                    } catch (err: any) {
                      onToast('error', err?.message || 'Subscription update failed');
                    }
                  }}
                  className="h-7 px-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 uppercase text-[10px]"
                >
                  <option value="free">free</option>
                  <option value="starter">starter</option>
                  <option value="pro">pro</option>
                  <option value="enterprise">enterprise</option>
                </select>
              </div>
            )}
          </div>
        ))}
      </div>

      {inspectingUser && inspectedEntitlements && (
        <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-cyan-200 truncate">Entitlements: {inspectingUser.email}</h3>
            <button
              type="button"
              onClick={() => {
                setInspectingUser(null);
                setInspectedEntitlements(null);
              }}
              className="text-slate-400 hover:text-white text-[11px]"
            >
              Close
            </button>
          </div>
          <p className="text-slate-300">
            Plan: <strong>{inspectedEntitlements.plan_name}</strong> · Storage Quota:{' '}
            {formatFileSize(inspectedEntitlements.storage_quota_bytes)} · Max File:{' '}
            {formatFileSize(inspectedEntitlements.max_file_size_bytes)}
          </p>
          <div className="flex flex-wrap gap-1">
            {(inspectedEntitlements.enabled_features || []).map((f) => (
              <span key={f} className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px]">
                {f}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                const updated = await apiClient.updateAdminUserEntitlements(inspectingUser.id, {
                  feature_overrides: [{ feature_key: 'ocr_engine', is_enabled: true }],
                  admin_notes: 'Enabled from mobile admin console',
                });
                if (updated?.entitlements) {
                  setInspectedEntitlements(updated.entitlements);
                }
                onToast('success', 'Applied entitlement override (ocr_engine enabled).');
              } catch (err: any) {
                onToast('error', err?.message || 'Failed to update entitlements');
              }
            }}
            className="w-full h-9 rounded-xl bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 font-semibold"
          >
            Grant OCR Engine Override
          </button>
        </div>
      )}

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
