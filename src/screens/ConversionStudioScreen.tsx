import React, { useEffect, useRef, useState } from 'react';
import { Download, FileUp, Repeat, Share2, Upload, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ConversionResult, executeFileConversion } from '../engines/converter';
import { detectFileFormat, FORMAT_REGISTRY, formatFileSize } from '../engines/formatDetector';
import { apiClient } from '../services/apiClient';
import { hapticTap, saveFileToDevice, shareDocumentFile } from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';
import { FileFormat } from '../types';

interface ConversionStudioScreenProps {
  initialFile?: File | null;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}

export const ConversionStudioScreen: React.FC<ConversionStudioScreenProps> = ({ initialFile, onToast }) => {
  const { isOnline } = useAuth();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceFormat, setSourceFormat] = useState<FileFormat | null>(null);
  const [targetFormat, setTargetFormat] = useState<FileFormat>('pdf');
  const [executionMode, setExecutionMode] = useState<'device' | 'cloud'>('device');
  const [progress, setProgress] = useState(0);
  const [stepLabel, setStepLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [cloudResult, setCloudResult] = useState<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectFile = async (f: File) => {
    setResult(null);
    setCloudResult(null);
    const detected = await detectFileFormat(f);
    if (!detected) {
      onToast('error', `Unsupported or invalid file format for "${f.name}".`);
      return;
    }
    setSourceFile(f);
    setSourceFormat(detected);
    const allowed = FORMAT_REGISTRY[detected].allowedConversions;
    setTargetFormat(allowed[0] || 'pdf');
  };

  useEffect(() => {
    if (initialFile) {
      selectFile(initialFile);
    }
  }, [initialFile]);

  const handleConvert = async () => {
    if (!sourceFile || !sourceFormat) return;
    setBusy(true);
    setResult(null);
    setCloudResult(null);
    setProgress(5);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (executionMode === 'cloud') {
        if (!isOnline) throw new Error('Cloud conversion requires network connectivity.');
        setStepLabel('Uploading source file to OmniDoc Vault...');
        const uploaded = await apiClient.uploadDocument(sourceFile, (p) => setProgress(Math.round(p * 0.5)));
        setStepLabel(`Invoking backend convert_document (${targetFormat.toUpperCase()})...`);
        setProgress(70);
        const toolRes = await apiClient.invokeTool('convert_document', {
          document_id: uploaded.id,
          target_format: targetFormat,
        });
        if (!toolRes.success) {
          throw new Error(toolRes.error || 'Server conversion failed');
        }
        setProgress(100);
        setCloudResult(toolRes.data);
        await offlineStore.appendHistory({
          kind: 'conversion',
          title: `Cloud Convert: ${sourceFile.name}`,
          sourceFormat,
          targetFormat,
          sizeBytes: sourceFile.size,
          status: 'completed',
          documentId: toolRes.data?.output_document_id || uploaded.id,
        });
        onToast('success', 'Server conversion completed and saved in Vault.');
      } else {
        const res = await executeFileConversion(
          sourceFile,
          sourceFormat,
          targetFormat,
          { signal: controller.signal },
          (pct, msg) => {
            setProgress(pct);
            setStepLabel(msg);
          }
        );
        setResult(res);
        await hapticTap('medium');
        await offlineStore.appendHistory({
          kind: 'conversion',
          title: `Converted ${sourceFile.name}`,
          sourceFormat,
          targetFormat,
          sizeBytes: res.blob.size,
          status: 'completed',
        });
        onToast('success', `Converted to ${res.fileName}`);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        await offlineStore.appendHistory({
          kind: 'conversion',
          title: `Failed: ${sourceFile.name}`,
          sourceFormat,
          targetFormat,
          sizeBytes: sourceFile.size,
          status: 'failed',
          error: err?.message,
        });
        onToast('error', err?.message || 'Conversion failed');
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const allowedTargets = sourceFormat ? FORMAT_REGISTRY[sourceFormat].allowedConversions : [];

  return (
    <div className="space-y-4 pb-6">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.docx,.pptx,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.txt,.md,.html"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) selectFile(f);
          e.target.value = '';
        }}
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full h-14 rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/70 flex items-center justify-center gap-2.5 text-sm font-semibold text-slate-200 active:bg-slate-800"
      >
        <FileUp className="w-5 h-5 text-amber-400" />
        {sourceFile ? `${sourceFile.name} (${formatFileSize(sourceFile.size)})` : 'Select Document to Convert'}
      </button>

      {sourceFile && sourceFormat && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Detected Format</span>
            <span className="px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold uppercase">
              {sourceFormat}
            </span>
          </div>

          <div>
            <p className="text-xs text-slate-400 mb-2">Target Format</p>
            <div className="flex flex-wrap gap-2">
              {allowedTargets.map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setTargetFormat(fmt)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold uppercase border ${
                    targetFormat === fmt
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-400 mb-2">Execution Engine</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setExecutionMode('device')}
                className={`py-2.5 rounded-xl text-xs font-semibold border ${
                  executionMode === 'device'
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                On-Device (Offline OK)
              </button>
              <button
                onClick={() => setExecutionMode('cloud')}
                disabled={!isOnline}
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

          {busy ? (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-amber-300">{stepLabel}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <button
                onClick={() => abortRef.current?.abort()}
                className="w-full h-10 rounded-xl bg-slate-800 text-xs text-rose-300 flex items-center justify-center gap-1.5"
              >
                <XCircle className="w-4 h-4" /> Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={handleConvert}
              className="w-full h-12 rounded-xl bg-amber-600 text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              <Repeat className="w-4 h-4" /> Convert to {targetFormat.toUpperCase()}
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-2xl p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-emerald-300">Conversion Complete</p>
            <p className="text-xs text-slate-300">
              {result.fileName} · {formatFileSize(result.blob.size)}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={async () => {
                const saved = await saveFileToDevice(result.blob, result.fileName);
                onToast('success', `Saved to ${saved.path}`);
              }}
              className="h-10 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <Download className="w-4 h-4 text-cyan-400" /> Save
            </button>
            <button
              onClick={() => shareDocumentFile(result.blob, result.fileName, result.fileName)}
              className="h-10 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <Share2 className="w-4 h-4 text-indigo-400" /> Share
            </button>
            <button
              disabled={!isOnline}
              onClick={async () => {
                try {
                  const file = new File([result.blob], result.fileName, { type: result.mimeType });
                  const up = await apiClient.uploadDocument(file);
                  onToast('success', `Uploaded "${up.filename}" to vault.`);
                } catch (err: any) {
                  onToast('error', err?.message || 'Upload failed');
                }
              }}
              className="h-10 rounded-xl bg-emerald-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Upload className="w-4 h-4" /> Upload
            </button>
          </div>
        </div>
      )}

      {cloudResult && (
        <div className="bg-cyan-950/40 border border-cyan-500/30 rounded-2xl p-4 space-y-2">
          <p className="text-sm font-bold text-cyan-300">Backend Conversion Recorded</p>
          <p className="text-xs text-slate-300">
            Output Artifact ID: <span className="font-mono">{cloudResult.output_document_id || 'Completed'}</span>
          </p>
          {cloudResult.output_document_id && (
            <button
              onClick={async () => {
                const blob = await apiClient.downloadDocument(cloudResult.output_document_id);
                const outName = `${sourceFile?.name.split('.')[0] || 'converted'}.${targetFormat}`;
                const saved = await saveFileToDevice(blob, outName);
                onToast('success', `Saved to ${saved.path}`);
              }}
              className="w-full h-10 rounded-xl bg-cyan-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
            >
              <Download className="w-4 h-4" /> Download Converted Document
            </button>
          )}
        </div>
      )}
    </div>
  );
};
