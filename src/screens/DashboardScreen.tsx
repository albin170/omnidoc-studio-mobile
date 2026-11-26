import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  Camera,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  HardDrive,
  Layers,
  PenTool,
  Presentation,
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
  unreadCount?: number;
  onNavigateTab: (tab: MobileTab) => void;
  onOpenSubView: (view: MobileSubView) => void;
  onQuickCameraScan: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  unreadCount = 0,
  onNavigateTab,
  onOpenSubView,
  onQuickCameraScan,
}) => {
  const { user, entitlements, uiConfig, isOnline } = useAuth();
  const [usage, setUsage] = useState<UserUsageMetrics | null>(null);
  const [recentDocs, setRecentDocs] = useState<BackendDocument[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pullOffset, setPullOffset] = useState(0);

  const touchStartYRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const scrollParent = containerRef.current?.closest('main');
    if (scrollParent && scrollParent.scrollTop > 4) {
      touchStartYRef.current = null;
      return;
    }
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartYRef.current === null || refreshing) return;
    const currentY = e.touches[0]?.clientY ?? touchStartYRef.current;
    const delta = currentY - touchStartYRef.current;
    if (delta > 0) {
      setPullOffset(Math.min(64, Math.round(delta * 0.45)));
    }
  };

  const handleTouchEnd = () => {
    if (pullOffset >= 44 && !refreshing) {
      loadDashboard();
    }
    touchStartYRef.current = null;
    setPullOffset(0);
  };

  const usedBytes = usage?.storage_used_bytes ?? 0;
  const quotaBytes = usage?.storage_quota_bytes ?? entitlements?.storage_quota_bytes ?? 1024 * 1024 * 1024;
  const quotaPct = Math.min(100, Math.round((usedBytes / Math.max(1, quotaBytes)) * 100));
  const recentJobs = usage?.recent_jobs ?? [];

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="space-y-4 pb-6"
    >
      {pullOffset > 8 && (
        <div
          className="flex items-center justify-center gap-2 text-[11px] text-indigo-300 transition-all"
          style={{ height: `${Math.min(36, pullOffset)}px` }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${pullOffset >= 44 ? 'animate-spin' : ''}`} />
          <span>{pullOffset >= 44 ? 'Release to sync...' : 'Pull down to refresh'}</span>
        </div>
      )}

      {/* Greeting + Subscription Tier + Refresh */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">Workspace Overview</p>
          <h2 className="text-xl font-bold tracking-tight text-slate-50 truncate">
            {user?.fullName || 'OmniDoc User'}
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            {entitlements?.plan_name || user?.planTier || 'Free'}
          </span>
          <button
            type="button"
            onClick={loadDashboard}
            disabled={refreshing}
            className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300 active:bg-slate-800 disabled:opacity-60"
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

      {/* Unread Notifications Card */}
      <button
        type="button"
        onClick={() => onOpenSubView('notifications')}
        className={`w-full rounded-2xl p-3.5 border flex items-center justify-between gap-3 text-left transition-colors ${
          unreadCount > 0
            ? 'bg-slate-900 border-indigo-500/40 active:bg-slate-800'
            : 'bg-slate-900 border-slate-800 active:bg-slate-800'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              unreadCount > 0 ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-400'
            }`}
          >
            <Bell className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100">
              {unreadCount > 0
                ? `${unreadCount} Unread Notification${unreadCount === 1 ? '' : 's'}`
                : 'Notifications & Alerts'}
            </p>
            <p className="text-[11px] text-slate-400 truncate">
              {unreadCount > 0 ? 'Tap to review workflow and account alerts' : 'All notifications caught up · Tap to open inbox'}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-rose-500 text-white text-xs font-bold shrink-0">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Storage & Usage Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1.5">
            <HardDrive className="w-4 h-4 text-cyan-400" />
            Shared Vault Storage ({quotaPct}%)
          </span>
          <span className="font-semibold text-slate-200">
            {formatFileSize(usedBytes)} / {formatFileSize(quotaBytes)}
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${quotaPct}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1 text-center">
          <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800">
            <p className="text-lg font-bold text-white">{usage?.documents_count ?? recentDocs.length}</p>
            <p className="text-[11px] text-slate-400">Documents</p>
          </div>
          <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800">
            <p className="text-lg font-bold text-white">{usage?.jobs_count ?? 0}</p>
            <p className="text-[11px] text-slate-400">Jobs</p>
          </div>
          <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800">
            <p className="text-sm font-bold text-emerald-400 flex items-center justify-center gap-1 pt-0.5">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="truncate">{user?.role?.toUpperCase()}</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Role</p>
          </div>
        </div>
        {lastSync && (
          <p className="text-[10px] text-slate-500 text-right">
            Last synced: {new Date(lastSync).toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Quick Action Launchers */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Quick Launchers</h3>
          <button
            type="button"
            onClick={() => onOpenSubView('studios_hub')}
            className="text-xs text-indigo-400 font-medium flex items-center gap-1"
          >
            <Layers className="w-3.5 h-3.5" /> All Studios
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onQuickCameraScan}
            className="p-3.5 rounded-2xl bg-slate-900 border border-indigo-500/35 flex items-center gap-3 text-left active:bg-slate-800"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center text-indigo-300 shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100">Scan to PDF</p>
              <p className="text-[11px] text-slate-400 truncate">Camera capture</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab('convert')}
            className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-left active:bg-slate-800"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-300 shrink-0">
              <Repeat className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100">Convert</p>
              <p className="text-[11px] text-slate-400 truncate">Batch &amp; 11 formats</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab('pdf')}
            className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-left active:bg-slate-800"
          >
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-300 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100">PDF Studio</p>
              <p className="text-[11px] text-slate-400 truncate">Edit, sign, search</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenSubView('word_studio')}
            className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-left active:bg-slate-800"
          >
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center text-sky-300 shrink-0">
              <PenTool className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100">Word Studio</p>
              <p className="text-[11px] text-slate-400 truncate">Rich DOCX editor</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenSubView('sheets_studio')}
            className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-left active:bg-slate-800"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-300 shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100">Excel Sheets</p>
              <p className="text-[11px] text-slate-400 truncate">Formulas &amp; grid</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onOpenSubView('slides_studio')}
            className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-left active:bg-slate-800"
          >
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/25 flex items-center justify-center text-orange-300 shrink-0">
              <Presentation className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100">PowerPoint</p>
              <p className="text-[11px] text-slate-400 truncate">Decks &amp; present</p>
            </div>
          </button>
        </div>
      </div>

      {/* AI Assistant + Upload Strip */}
      <div className="grid grid-cols-1 gap-2.5">
        <button
          type="button"
          onClick={() => onOpenSubView('ai_assistant')}
          className="w-full p-3.5 rounded-2xl bg-slate-900 border border-violet-500/35 flex items-center justify-between text-left active:bg-slate-800"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center text-violet-300 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-100">OmniCore AI &amp; Document Q&amp;A</p>
              <p className="text-[11px] text-slate-400">Query indexed documents or run agent workflows</p>
            </div>
          </div>
        </button>
      </div>

      {/* Recent Documents */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent Documents</h3>
          <button
            type="button"
            onClick={() => onNavigateTab('docs')}
            className="text-xs text-indigo-400 font-medium flex items-center gap-1"
          >
            <Upload className="w-3.5 h-3.5" /> Open Docs
          </button>
        </div>

        {recentDocs.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-center text-xs text-slate-400">
            <FolderOpen className="w-7 h-7 mx-auto mb-2 text-slate-600" />
            No documents synced yet. Upload a document in Docs or scan with your camera.
          </div>
        ) : (
          <div className="space-y-2">
            {recentDocs.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => onNavigateTab('docs')}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3 text-left active:bg-slate-800"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100 truncate">{doc.filename}</p>
                    <p className="text-[11px] text-slate-400">
                      {doc.format_type.toUpperCase()} · {formatFileSize(doc.file_size)}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                  v{doc.version}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recent Processing Jobs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent Processing Jobs</h3>
          <button
            type="button"
            onClick={() => onOpenSubView('history')}
            className="text-xs text-indigo-400 font-medium"
          >
            View History
          </button>
        </div>

        {recentJobs.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center text-xs text-slate-400">
            <Clock className="w-6 h-6 mx-auto mb-1.5 text-slate-600" />
            No recent cloud processing jobs recorded.
          </div>
        ) : (
          <div className="space-y-2">
            {recentJobs.slice(0, 4).map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => onOpenSubView('history')}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3 text-left active:bg-slate-800"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2
                    className={`w-4 h-4 shrink-0 ${
                      job.status === 'completed'
                        ? 'text-emerald-400'
                        : job.status === 'failed' || job.status === 'cancelled'
                        ? 'text-rose-400'
                        : 'text-indigo-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100 truncate">{job.title || job.type}</p>
                    <p className="text-[11px] text-slate-400">
                      {job.mode} · {new Date(job.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                  {job.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
