import React, { useCallback, useEffect, useState } from 'react';
import {
  Camera,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatFileSize } from '../engines/formatDetector';
import { apiClient } from '../services/apiClient';
import { offlineStore } from '../services/offlineStore';
import { BackendDocument, MobileSubView, MobileTab, UserUsageMetrics } from '../types';

interface DashboardScreenProps {
  onNavigateTab: (tab: MobileTab) => void;
  onOpenSubView: (view: MobileSubView) => void;
  onQuickCameraScan: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  onNavigateTab,
  onOpenSubView,
  onQuickCameraScan,
}) => {
  const { user, entitlements, uiConfig, isOnline } = useAuth();
  const [usage, setUsage] = useState<UserUsageMetrics | null>(null);
  const [recentDocs, setRecentDocs] = useState<BackendDocument[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);
    try {
      const [cachedU, cachedD, syncTs] = await Promise.all([
        offlineStore.getCachedUsage(),
        offlineStore.getCachedDocuments(),
        offlineStore.getLastSyncTimestamp(),
      ]);
      if (cachedU) setUsage(cachedU);
      if (cachedD.length > 0) setRecentDocs(cachedD.slice(0, 4));
      setLastSync(syncTs);

      if (isOnline) {
        const [liveUsage, liveDocs] = await Promise.all([
          apiClient.getUsage().catch(() => null),
          apiClient.listDocuments().catch(() => null),
        ]);
        if (liveUsage) {
          setUsage(liveUsage);
          await offlineStore.cacheUsage(liveUsage);
        }
        if (liveDocs) {
          setRecentDocs(liveDocs.slice(0, 4));
          await offlineStore.cacheDocuments(liveDocs);
          setLastSync(Date.now());
        }
      }
    } finally {
      setRefreshing(false);
    }
  }, [isOnline]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const usedBytes = usage?.storage_used_bytes ?? 0;
  const quotaBytes = usage?.storage_quota_bytes ?? entitlements?.storage_quota_bytes ?? 1024 * 1024 * 1024;
  const quotaPct = Math.min(100, Math.round((usedBytes / Math.max(1, quotaBytes)) * 100));

  return (
    <div className="space-y-4 pb-4">
      {/* Greeting + Plan Badge */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">Welcome back</p>
          <h2 className="text-xl font-bold tracking-tight">{user?.fullName || 'OmniDoc User'}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            {entitlements?.plan_name || user?.planTier || 'Free'}
          </span>
          <button
            onClick={loadDashboard}
            className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 active:bg-slate-700"
            aria-label="Refresh dashboard"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* System Announcement / Maintenance Banner */}
      {uiConfig?.maintenance_mode && (
        <div className="p-3.5 rounded-2xl bg-amber-950/70 border border-amber-500/40 text-amber-200 text-xs">
          <strong>Maintenance Notice:</strong> {uiConfig.maintenance_message || 'Scheduled maintenance active.'}
        </div>
      )}
      {uiConfig?.announcement_banner && (
        <div className="p-3.5 rounded-2xl bg-indigo-950/60 border border-indigo-500/30 text-indigo-200 text-xs">
          {uiConfig.announcement_banner}
        </div>
      )}

      {/* Storage & Usage Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1.5">
            <HardDrive className="w-4 h-4 text-cyan-400" />
            Shared Vault Storage
          </span>
          <span className="font-semibold text-slate-200">
            {formatFileSize(usedBytes)} / {formatFileSize(quotaBytes)}
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all"
            style={{ width: `${quotaPct}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1 text-center">
          <div className="bg-slate-950/70 rounded-xl p-2.5 border border-slate-800/70">
            <p className="text-lg font-bold text-white">{usage?.documents_count ?? recentDocs.length}</p>
            <p className="text-[11px] text-slate-400">Documents</p>
          </div>
          <div className="bg-slate-950/70 rounded-xl p-2.5 border border-slate-800/70">
            <p className="text-lg font-bold text-white">{usage?.jobs_count ?? 0}</p>
            <p className="text-[11px] text-slate-400">Jobs</p>
          </div>
          <div className="bg-slate-950/70 rounded-xl p-2.5 border border-slate-800/70">
            <p className="text-lg font-bold text-emerald-400 flex items-center justify-center gap-1">
              <ShieldCheck className="w-4 h-4" />
              {user?.role?.toUpperCase()}
            </p>
            <p className="text-[11px] text-slate-400">Role</p>
          </div>
        </div>
        {lastSync && (
          <p className="text-[10px] text-slate-500 text-right">
            Last synced: {new Date(lastSync).toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Mobile Quick Actions */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={onQuickCameraScan}
            className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-600/25 to-cyan-600/15 border border-indigo-500/30 flex items-center gap-3 text-left active:scale-[0.99]"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-500/25 flex items-center justify-center text-indigo-300 shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Scan to PDF</p>
              <p className="text-[11px] text-slate-400">Camera capture</p>
            </div>
          </button>

          <button
            onClick={() => onNavigateTab('library')}
            className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-left active:bg-slate-800"
          >
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-300 shrink-0">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Upload File</p>
              <p className="text-[11px] text-slate-400">Sync to vault</p>
            </div>
          </button>

          <button
            onClick={() => onOpenSubView('conversion_studio')}
            className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-left active:bg-slate-800"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-300 shrink-0">
              <Repeat className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Convert</p>
              <p className="text-[11px] text-slate-400">PDF, Office, Img</p>
            </div>
          </button>

          <button
            onClick={() => onOpenSubView('sheets_studio')}
            className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-left active:bg-slate-800"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-300 shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Excel Sheets</p>
              <p className="text-[11px] text-slate-400">Formulas &amp; grid</p>
            </div>
          </button>
        </div>
      </div>

      {/* AI Assistant Banner */}
      <button
        onClick={() => onOpenSubView('ai_assistant')}
        className="w-full p-3.5 rounded-2xl bg-gradient-to-r from-violet-600/20 via-indigo-600/20 to-slate-900 border border-violet-500/30 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/25 flex items-center justify-center text-violet-300">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">OmniCore AI &amp; Document Q&amp;A</p>
            <p className="text-[11px] text-slate-400">Query indexed documents or run agent workflows</p>
          </div>
        </div>
      </button>

      {/* Recent Documents */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent Documents</h3>
          <button onClick={() => onNavigateTab('library')} className="text-xs text-indigo-400 font-medium">
            View All
          </button>
        </div>

        {recentDocs.length === 0 ? (
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 text-center text-xs text-slate-400">
            <FolderOpen className="w-7 h-7 mx-auto mb-2 text-slate-600" />
            No documents synced yet. Upload a document or scan with your camera.
          </div>
        ) : (
          <div className="space-y-2">
            {recentDocs.map((doc) => (
              <div
                key={doc.id}
                onClick={() => onNavigateTab('library')}
                className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3 active:bg-slate-800"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{doc.filename}</p>
                    <p className="text-[11px] text-slate-400">
                      {doc.format_type.toUpperCase()} · {formatFileSize(doc.file_size)}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                  v{doc.version}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
