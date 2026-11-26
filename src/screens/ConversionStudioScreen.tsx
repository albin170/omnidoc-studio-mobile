import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Download,
  FileUp,
  Play,
  RefreshCw,
  Repeat,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  createBatchZipArchive,
  executeFileConversion,
  getConversionCompatibilityReport,
} from '../engines/converter';
import { detectFileFormat, FORMAT_REGISTRY, formatFileSize } from '../engines/formatDetector';
import { apiClient } from '../services/apiClient';
import { hapticTap, saveFileToDevice, shareDocumentFile } from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';
import { ConversionJob, FileFormat } from '../types';

export interface ConversionStudioScreenProps {
  initialFile?: File | null;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}

export const ConversionStudioScreen: React.FC<ConversionStudioScreenProps> = ({ initialFile, onToast }) => {
  const { isOnline } = useAuth();
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [stepLabels, setStepLabels] = useState<Record<string, string>>({});
  const [executionMode, setExecutionMode] = useState<'device' | 'cloud'>('device');
  const [isConvertingAll, setIsConvertingAll] = useState(false);
  const [isPackagingZip, setIsPackagingZip] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const jobsRef = useRef<ConversionJob[]>([]);
  const lastInitialFileRef = useRef<File | null>(null);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    return () => {
      abortControllersRef.current.forEach((ctrl) => ctrl.abort());
      abortControllersRef.current.clear();
    };
  }, []);

  const addFilesToQueue = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const addedJobs: ConversionJob[] = [];

      for (const f of files) {
        const detected = await detectFileFormat(f);
        if (!detected) {
          onToast('error', `Unsupported or invalid file format for "${f.name}".`);
          continue;
        }
        const allowed = FORMAT_REGISTRY[detected].allowedConversions;
        addedJobs.push({
          id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          sourceFile: f,
          sourceFormat: detected,
          targetFormat: allowed[0] || 'pdf',
          status: 'queued',
          progress: 0,
          createdAt: Date.now(),
        });
      }

      if (addedJobs.length > 0) {
        setJobs((prev) => [...prev, ...addedJobs]);
      }
    },
    [onToast]
  );

  useEffect(() => {
    if (initialFile && initialFile !== lastInitialFileRef.current) {
      lastInitialFileRef.current = initialFile;
      void addFilesToQueue([initialFile]);
    }
  }, [initialFile, addFilesToQueue]);

  const setJobStep = (jobId: string, label: string) => {
    setStepLabels((prev) => ({ ...prev, [jobId]: label }));
  };

  const handleTargetFormatChange = (jobId: string, newTarget: FileFormat) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              targetFormat: newTarget,
              status: 'queued',
              progress: 0,
              resultBlob: undefined,
              resultFileName: undefined,
              errorMessage: undefined,
            }
          : j
      )
    );
    setJobStep(jobId, '');
  };

  const cancelJob = (jobId: string) => {
    const controller = abortControllersRef.current.get(jobId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(jobId);
    }
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? { ...j, status: 'cancelled', progress: 0, errorMessage: 'Cancelled by user' }
          : j
      )
    );
    setJobStep(jobId, 'Cancelled');
  };

  const removeJob = (jobId: string) => {
    const controller = abortControllersRef.current.get(jobId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(jobId);
    }
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  };

  const runJob = async (jobId: string) => {
    const job = jobsRef.current.find((j) => j.id === jobId);
    if (!job || job.status === 'processing') return;

    const controller = new AbortController();
    abortControllersRef.current.set(jobId, controller);

    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId ? { ...j, status: 'processing', progress: 5, errorMessage: undefined } : j
      )
    );
    setJobStep(jobId, 'Initializing conversion...');

    const checkAborted = () => {
      if (controller.signal.aborted) {
        throw new DOMException('Conversion cancelled by user', 'AbortError');
      }
    };

    try {
      if (executionMode === 'cloud') {
        if (!isOnline) throw new Error('Cloud conversion requires network connectivity.');
        setJobStep(jobId, 'Uploading source file to OmniDoc Vault...');
        const uploaded = await apiClient.uploadDocument(
          job.sourceFile,
          (p) => {
            if (controller.signal.aborted) return;
            setJobs((prev) =>
              prev.map((j) => (j.id === jobId ? { ...j, progress: Math.max(5, Math.round(p * 0.4)) } : j))
            );
          },
          controller.signal
        );
        checkAborted();

        setJobStep(jobId, `Invoking cloud convert_document (${job.targetFormat.toUpperCase()})...`);
        setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, progress: 55 } : j)));
        const toolRes = await apiClient.invokeTool('convert_document', {
          document_id: uploaded.id,
          target_format: job.targetFormat,
        });
        checkAborted();

        if (!toolRes?.success) {
          throw new Error(toolRes?.error || 'Server conversion failed');
        }

        const outputDocId = toolRes.data?.output_document_id;
        if (!outputDocId) {
          throw new Error('Server conversion finished without an output document ID.');
        }

        setJobStep(jobId, 'Downloading converted output...');
        setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, progress: 70 } : j)));
        const resultBlob = await apiClient.downloadDocument(
          outputDocId,
          (dlPct) => {
            if (controller.signal.aborted) return;
            setJobs((prev) =>
              prev.map((j) => (j.id === jobId ? { ...j, progress: Math.min(99, 70 + Math.round(dlPct * 0.3)) } : j))
            );
          },
          controller.signal
        );
        checkAborted();

        const dotIdx = job.sourceFile.name.lastIndexOf('.');
        const baseName = dotIdx > 0 ? job.sourceFile.name.slice(0, dotIdx) : job.sourceFile.name;
        const resultFileName = toolRes.data?.filename || `${baseName}.${job.targetFormat}`;

        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, status: 'completed', progress: 100, resultBlob, resultFileName }
              : j
          )
        );
        setJobStep(jobId, 'Completed (Cloud)');
        await hapticTap('medium');
        await offlineStore.appendHistory({
          kind: 'conversion',
          title: `Cloud Convert: ${job.sourceFile.name}`,
          sourceFormat: job.sourceFormat,
          targetFormat: job.targetFormat,
          sizeBytes: resultBlob.size || job.sourceFile.size,
          status: 'completed',
          documentId: outputDocId,
        });
        onToast('success', `Converted "${job.sourceFile.name}" via Cloud API.`);
      } else {
        const res = await executeFileConversion(
          job.sourceFile,
          job.sourceFormat,
          job.targetFormat,
          { signal: controller.signal },
          (pct, msg) => {
            if (controller.signal.aborted) return;
            setJobStep(jobId, msg);
            setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, progress: pct } : j)));
          }
        );
        checkAborted();

        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: 'completed',
                  progress: 100,
                  resultBlob: res.blob,
                  resultFileName: res.fileName,
                }
              : j
          )
        );
        setJobStep(jobId, 'Completed');
        await hapticTap('medium');
        await offlineStore.appendHistory({
          kind: 'conversion',
          title: `Converted ${job.sourceFile.name}`,
          sourceFormat: job.sourceFormat,
          targetFormat: job.targetFormat,
          sizeBytes: res.blob.size,
          status: 'completed',
        });
        onToast('success', `Converted to ${res.fileName}`);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, status: 'cancelled', progress: 0, errorMessage: 'Cancelled by user' }
              : j
          )
        );
        setJobStep(jobId, 'Cancelled');
        return;
      }

      const errMsg = err?.message || 'Conversion failed';
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'error', progress: 0, errorMessage: errMsg } : j
        )
      );
      setJobStep(jobId, 'Failed');
      await offlineStore.appendHistory({
        kind: 'conversion',
        title: `Failed: ${job.sourceFile.name}`,
        sourceFormat: job.sourceFormat,
        targetFormat: job.targetFormat,
        sizeBytes: job.sourceFile.size,
        status: 'failed',
        error: errMsg,
      });
      onToast('error', errMsg);
    } finally {
      abortControllersRef.current.delete(jobId);
    }
  };

  const handleConvertAll = async () => {
    if (isConvertingAll) return;
    setIsConvertingAll(true);
    try {
      const pendingIds = jobsRef.current
        .filter((j) => j.status === 'queued' || j.status === 'error' || j.status === 'cancelled')
        .map((j) => j.id);
      for (const id of pendingIds) {
        if (!jobsRef.current.some((j) => j.id === id)) continue;
        await runJob(id);
      }
    } finally {
      setIsConvertingAll(false);
    }
  };

  const handleDownloadBatchZip = async () => {
    const completed = jobsRef.current.filter((j) => j.status === 'completed' && j.resultBlob);
    if (completed.length === 0) return;

    setIsPackagingZip(true);
    try {
      const zipBlob = await createBatchZipArchive(completed);
      const saved = await saveFileToDevice(zipBlob, `OmniDoc_Batch_${Date.now()}.zip`);
      await hapticTap('medium');
      onToast('success', `Saved batch ZIP (${completed.length} files) to ${saved.path}`);
    } catch (err: any) {
      onToast('error', err?.message || 'Batch ZIP packaging failed');
    } finally {
      setIsPackagingZip(false);
    }
  };

  const completedJobs = jobs.filter((j) => j.status === 'completed' && j.resultBlob);
  const pendingCount = jobs.filter(
    (j) => j.status === 'queued' || j.status === 'error' || j.status === 'cancelled'
  ).length;

  return (
    <div className="space-y-4 pb-6">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.docx,.pptx,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.txt,.md,.html"
        onChange={(e) => {
          if (e.target.files) void addFilesToQueue(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      {/* Multi-file Drop / Picker */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full h-14 rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/70 flex items-center justify-center gap-2.5 text-sm font-semibold text-slate-200 active:bg-slate-800 px-4"
      >
        <FileUp className="w-5 h-5 text-amber-400 shrink-0" />
        <span className="truncate">
          {jobs.length > 0
            ? `Add More Files (${jobs.length} in queue)`
            : 'Select Documents to Convert (Batch Supported)'}
        </span>
      </button>

      {/* Execution Engine Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
        <p className="text-[11px] font-semibold text-slate-400">Execution Engine</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setExecutionMode('device')}
            disabled={isConvertingAll}
            className={`py-2.5 rounded-xl text-xs font-semibold border disabled:opacity-60 ${
              executionMode === 'device'
                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            On-Device (Offline OK)
          </button>
          <button
            onClick={() => setExecutionMode('cloud')}
            disabled={!isOnline || isConvertingAll}
            className={`py-2.5 rounded-xl text-xs font-semibold border disabled:opacity-40 ${
              executionMode === 'cloud'
                ? 'bg-cyan-600/20 border-cyan-500 text-cyan-200'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            Backend Tool API
          </button>
        </div>
      </div>

      {/* Batch Toolbar */}
      {jobs.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleConvertAll}
            disabled={isConvertingAll || pendingCount === 0}
            className="flex-1 h-11 rounded-xl bg-amber-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Repeat className="w-4 h-4" />
            {isConvertingAll ? 'Converting Batch...' : `Convert All (${pendingCount})`}
          </button>
          <button
            onClick={handleDownloadBatchZip}
            disabled={completedJobs.length === 0 || isPackagingZip}
            className="h-11 px-3.5 rounded-xl bg-cyan-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Archive className="w-4 h-4" />
            Download Batch ZIP ({completedJobs.length})
          </button>
          <button
            onClick={() => {
              abortControllersRef.current.forEach((ctrl) => ctrl.abort());
              abortControllersRef.current.clear();
              setJobs([]);
              setStepLabels({});
            }}
            disabled={isConvertingAll}
            aria-label="Clear conversion queue"
            className="h-11 w-11 rounded-xl bg-slate-800 text-slate-300 flex items-center justify-center disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
          </button>
        </div>
      )}

      {/* Batch Queue Items */}
      {jobs.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-1.5">
          <Repeat className="w-8 h-8 mx-auto text-amber-400" />
          <p className="text-sm font-semibold">Batch Conversion Queue Empty</p>
          <p className="text-xs text-slate-400">
            Select one or more PDF, DOCX, PPTX, XLSX, CSV, image, or text files to convert offline or via Cloud
            API.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const allowedTargets = FORMAT_REGISTRY[job.sourceFormat]?.allowedConversions || ['pdf'];
            const compat = getConversionCompatibilityReport(job.sourceFormat, job.targetFormat);
            const stepMsg = stepLabels[job.id];

            return (
              <div
                key={job.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3"
              >
                {/* Header Row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-100 truncate">{job.sourceFile.name}</p>
                    <p className="text-[11px] text-slate-400">
                      <span className="uppercase font-semibold text-indigo-300">{job.sourceFormat}</span> ·{' '}
                      {formatFileSize(job.sourceFile.size)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      aria-label={`Target format for ${job.sourceFile.name}`}
                      value={job.targetFormat}
                      disabled={job.status === 'processing'}
                      onChange={(e) => handleTargetFormatChange(job.id, e.target.value as FileFormat)}
                      className="h-8 px-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-semibold uppercase text-amber-300 outline-none"
                    >
                      {allowedTargets.map((fmt) => (
                        <option key={fmt} value={fmt}>
                          {fmt.toUpperCase()}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeJob(job.id)}
                      aria-label={`Remove ${job.sourceFile.name}`}
                      className="h-8 w-8 rounded-lg bg-slate-800 text-slate-400 hover:text-rose-400 flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Compatibility Fidelity Badge */}
                <div
                  className={`rounded-xl px-2.5 py-2 border text-[11px] space-y-0.5 ${
                    compat.fidelity === 'unsupported'
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                      : compat.fidelity === 'extraction'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                      : 'bg-indigo-500/10 border-indigo-500/30 text-sky-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      {compat.label}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-950/60 font-mono text-[10px] uppercase">
                      {compat.fidelity}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-300/90">
                    {compat.summary}
                    {compat.caveats.length > 0 ? ` ${compat.caveats[0]}` : ''}
                  </p>
                </div>

                {/* Per-item Progress Bar */}
                {(job.status === 'processing' || job.status === 'completed') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span
                        className={
                          job.status === 'completed' ? 'text-emerald-300 font-medium' : 'text-amber-300'
                        }
                      >
                        {job.status === 'completed'
                          ? `${job.resultFileName} · ${formatFileSize(job.resultBlob?.size || 0)}`
                          : stepMsg || 'Processing...'}
                      </span>
                      <span className="font-mono text-slate-300">{job.progress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          job.status === 'completed' ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {job.status === 'error' && (
                  <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2.5 py-1.5">
                    {job.errorMessage || 'Conversion failed'}
                  </p>
                )}

                {job.status === 'cancelled' && (
                  <p className="text-[11px] text-slate-400 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5">
                    Conversion cancelled.
                  </p>
                )}

                {/* Per-item Action Buttons */}
                {job.status === 'processing' && (
                  <button
                    onClick={() => cancelJob(job.id)}
                    className="w-full h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs font-semibold text-rose-300 flex items-center justify-center gap-1.5"
                  >
                    <XCircle className="w-4 h-4" /> Cancel
                  </button>
                )}

                {job.status === 'queued' && (
                  <button
                    onClick={() => runJob(job.id)}
                    disabled={!compat.supported}
                    className="w-full h-9 rounded-xl bg-amber-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
                  >
                    <Play className="w-3.5 h-3.5" /> Convert to {job.targetFormat.toUpperCase()}
                  </button>
                )}

                {(job.status === 'error' || job.status === 'cancelled') && (
                  <button
                    onClick={() => runJob(job.id)}
                    disabled={!compat.supported}
                    className="w-full h-9 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                  </button>
                )}

                {job.status === 'completed' && job.resultBlob && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-emerald-300 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={async () => {
                          if (!job.resultBlob) return;
                          const name =
                            job.resultFileName || `${job.sourceFile.name}.${job.targetFormat}`;
                          const saved = await saveFileToDevice(job.resultBlob, name);
                          onToast('success', `Saved to ${saved.path}`);
                        }}
                        className="h-9 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5 text-cyan-400" /> Save
                      </button>
                      <button
                        onClick={() => {
                          if (!job.resultBlob) return;
                          const name =
                            job.resultFileName || `${job.sourceFile.name}.${job.targetFormat}`;
                          void shareDocumentFile(job.resultBlob, name, name);
                        }}
                        className="h-9 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1"
                      >
                        <Share2 className="w-3.5 h-3.5 text-indigo-400" /> Share
                      </button>
                      <button
                        disabled={!isOnline}
                        onClick={async () => {
                          if (!job.resultBlob) return;
                          try {
                            const name =
                              job.resultFileName || `${job.sourceFile.name}.${job.targetFormat}`;
                            const mime =
                              job.resultBlob.type ||
                              FORMAT_REGISTRY[job.targetFormat]?.mimeType ||
                              'application/octet-stream';
                            const file = new File([job.resultBlob], name, { type: mime });
                            const up = await apiClient.uploadDocument(file);
                            onToast('success', `Uploaded "${up.filename}" to vault.`);
                          } catch (err: any) {
                            onToast('error', err?.message || 'Upload failed');
                          }
                        }}
                        className="h-9 rounded-xl bg-emerald-600 text-xs font-semibold text-white flex items-center justify-center gap-1 disabled:opacity-40"
                      >
                        <Upload className="w-3.5 h-3.5" /> Upload
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
