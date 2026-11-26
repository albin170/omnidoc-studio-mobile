import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Play, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { formatFileSize } from '../engines/formatDetector';
import { apiClient } from '../services/apiClient';
import { offlineStore } from '../services/offlineStore';
import { BackendDocument, BackendJob, LocalProcessingHistoryItem } from '../types';

export const HistoryScreen: React.FC<{ onToast: (type: 'info' | 'success' | 'error', message: string) => void }> = ({
  onToast,
}) => {
  const { isOnline } = useAuth();
  const [tab, setTab] = useState<'jobs' | 'local'>('jobs');
  const [jobs, setJobs] = useState<BackendJob[]>([]);
  const [localHistory, setLocalHistory] = useState<LocalProcessingHistoryItem[]>([]);
  const [docs, setDocs] = useState<BackendDocument[]>([]);
  const [loading, setLoading] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newObjective, setNewObjective] = useState('');
  const [selectedDocId, setSelectedDocId] = useState('');

  const [jobToCancel, setJobToCancel] = useState<BackendJob | null>(null);
  const [confirmClearLocal, setConfirmClearLocal] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const [cachedJobs, localItems, cachedDocs] = await Promise.all([
        offlineStore.getCachedJobs(),
        offlineStore.getLocalHistory(),
        offlineStore.getCachedDocuments(),
      ]);
      setJobs(cachedJobs);
      setLocalHistory(localItems);
      setDocs(cachedDocs);

      if (isOnline) {
        const [liveJobs, liveDocs] = await Promise.all([
          apiClient.listJobs().catch(() => null),
          apiClient.listDocuments().catch(() => null),
        ]);
        if (liveJobs) {
          setJobs(liveJobs);
          await offlineStore.cacheJobs(liveJobs);
        }
        if (liveDocs) {
          setDocs(liveDocs);
          if (!selectedDocId && liveDocs[0]) setSelectedDocId(liveDocs[0].id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [isOnline, selectedDocId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newObjective.trim()) return;
    try {
      await apiClient.submitJob(newTitle.trim(), newObjective.trim(), selectedDocId ? [selectedDocId] : []);
      setNewTitle('');
      setNewObjective('');
      onToast('success', 'Autonomous job submitted to OmniDoc backend.');
      await loadHistory();
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to submit job');
    }
  };

  const handleApprove = async (jobId: string, approved: boolean) => {
    try {
      await apiClient.approveJob(jobId, approved, approved ? undefined : 'Rejected on mobile');
      onToast('success', approved ? 'Step approved.' : 'Step rejected.');
      await loadHistory();
    } catch (err: any) {
      onToast('error', err?.message || 'Approval failed');
    }
  };

  const handleConfirmCancelJob = async () => {
    if (!jobToCancel) return;
    setConfirmBusy(true);
    try {
      await apiClient.cancelJob(jobToCancel.id);
      onToast('info', `Cancelled job "${jobToCancel.title}".`);
      setJobToCancel(null);
      await loadHistory();
    } catch (err: any) {
      onToast('error', err?.message || 'Cancel failed');
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleConfirmClearLocal = async () => {
    setConfirmBusy(true);
    try {
      await offlineStore.clearLocalHistory();
      setLocalHistory([]);
      setConfirmClearLocal(false);
      onToast('success', 'Local device processing history cleared.');
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center justify-between gap-2">
        <div className="grid grid-cols-2 gap-1 flex-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setTab('jobs')}
            className={`py-2 rounded-lg text-xs font-semibold ${
              tab === 'jobs' ? 'bg-indigo-600 text-white' : 'text-slate-400'
            }`}
          >
            Cloud Jobs ({jobs.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('local')}
            className={`py-2 rounded-lg text-xs font-semibold ${
              tab === 'local' ? 'bg-indigo-600 text-white' : 'text-slate-400'
            }`}
          >
            Device History ({localHistory.length})
          </button>
        </div>
        <button
          type="button"
          onClick={loadHistory}
          aria-label="Refresh jobs and history"
          className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {tab === 'jobs' ? (
        <>
          {isOnline && (
            <form onSubmit={handleCreateJob} className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-300">Submit New Processing Job</h3>
              <div>
                <label htmlFor="history-job-title" className="sr-only">
                  Job title
                </label>
                <input
                  id="history-job-title"
                  name="jobTitle"
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Job title (e.g. Inspect & Parse PDF)"
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="history-job-objective" className="sr-only">
                  Job objective
                </label>
                <input
                  id="history-job-objective"
                  name="jobObjective"
                  type="text"
                  required
                  value={newObjective}
                  onChange={(e) => setNewObjective(e.target.value)}
                  placeholder="Objective (e.g. extract fields and verify output)"
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              {docs.length > 0 && (
                <div>
                  <label htmlFor="history-job-doc" className="sr-only">
                    Attached document
                  </label>
                  <select
                    id="history-job-doc"
                    name="attachedDocumentId"
                    value={selectedDocId}
                    onChange={(e) => setSelectedDocId(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">No attached document</option>
                    {docs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.filename}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="submit"
                className="w-full h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" /> Run Workflow Job
              </button>
            </form>
          )}

          <div className="space-y-2.5">
            {jobs.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
                No cloud processing jobs yet.
              </div>
            ) : (
              jobs.map((job) => (
                <div key={job.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100 truncate">{job.title}</p>
                      <p className="text-xs text-slate-400">{job.objective}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase shrink-0 ${
                        job.status === 'completed'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : job.status === 'awaiting_approval'
                          ? 'bg-amber-500/15 text-amber-300'
                          : job.status === 'failed' || job.status === 'cancelled'
                          ? 'bg-rose-500/15 text-rose-300'
                          : 'bg-indigo-500/15 text-indigo-300'
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      Steps: {job.current_step_index}/{job.total_steps} · Mode: {job.mode}
                    </span>
                    <span>{new Date(job.created_at).toLocaleDateString()}</span>
                  </div>
                  {job.status === 'awaiting_approval' && isOnline && (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleApprove(job.id, true)}
                        className="flex-1 h-9 rounded-lg bg-emerald-600 text-xs font-semibold text-white"
                      >
                        Approve Step
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(job.id, false)}
                        className="flex-1 h-9 rounded-lg bg-rose-600/80 text-xs font-semibold text-white"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {(job.status === 'running' || job.status === 'pending') && isOnline && (
                    <button
                      type="button"
                      onClick={() => setJobToCancel(job)}
                      className="w-full h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-rose-300"
                    >
                      Cancel Job
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          {localHistory.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearLocal(true)}
              className="text-xs text-rose-400 flex items-center gap-1 ml-auto py-1 px-2 rounded-lg hover:bg-rose-950/40"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear Local History
            </button>
          )}
          {localHistory.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
              <Clock className="w-6 h-6 mx-auto mb-2 text-slate-600" />
              Conversions, PDF edits, scans, and uploads performed on this device appear here offline.
            </div>
          ) : (
            localHistory.map((item) => (
              <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {item.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100 truncate">{item.title}</p>
                    <p className="text-[11px] text-slate-400">
                      {item.sourceFormat.toUpperCase()} → {item.targetFormat.toUpperCase()} · {formatFileSize(item.sizeBytes)}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] text-slate-500 shrink-0">
                  {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(jobToCancel)}
        title="Cancel Processing Job?"
        message={
          jobToCancel
            ? `Stop "${jobToCancel.title}" on the OmniDoc backend? In-progress steps will halt.`
            : ''
        }
        confirmLabel="Cancel Job"
        cancelLabel="Keep Running"
        danger
        busy={confirmBusy}
        onConfirm={handleConfirmCancelJob}
        onCancel={() => !confirmBusy && setJobToCancel(null)}
      />

      <ConfirmDialog
        open={confirmClearLocal}
        title="Clear Local Device History?"
        message="This removes the local activity log stored on this device. Your cloud documents and jobs remain untouched."
        confirmLabel="Clear History"
        danger
        busy={confirmBusy}
        onConfirm={handleConfirmClearLocal}
        onCancel={() => !confirmBusy && setConfirmClearLocal(false)}
      />
    </div>
  );
};
