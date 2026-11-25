import React, { useEffect, useRef, useState } from 'react';
import { CloudUpload, Download, FilePlus2, Plus, Share2, SortAsc, Sparkles, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  columnIndexToLetter,
  convertSpreadsheetToPdf,
  evaluateCellFormula,
  exportDataToCsvBlob,
  exportMultiSheetWorkbookToBlob,
  parseSpreadsheetFile,
  removeDuplicateRows,
  sortSheetRows,
} from '../engines/sheetService';
import { apiClient } from '../services/apiClient';
import { saveFileToDevice, shareDocumentFile } from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';

interface SheetsStudioScreenProps {
  initialFile?: File | null;
  onToast: (type: 'info' | 'success' | 'error', message: string) => void;
}

function makeBlankSheet(): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (let r = 0; r < 16; r++) {
    rows.push(Array(8).fill(''));
  }
  rows[0][0] = 'Item';
  rows[0][1] = 'Qty';
  rows[0][2] = 'Price';
  rows[0][3] = 'Total';
  rows[1][0] = 'Starter Row';
  rows[1][1] = 2;
  rows[1][2] = 25;
  rows[1][3] = '=B2*C2';
  return rows;
}

export const SheetsStudioScreen: React.FC<SheetsStudioScreenProps> = ({ initialFile, onToast }) => {
  const { isOnline } = useAuth();
  const [title, setTitle] = useState('Mobile_Workbook');
  const [sheetNames, setSheetNames] = useState<string[]>(['Sheet1']);
  const [activeSheet, setActiveSheet] = useState('Sheet1');
  const [sheets, setSheets] = useState<Record<string, (string | number)[][]>>({ Sheet1: makeBlankSheet() });
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number }>({ r: 1, c: 3 });
  const [formulaInput, setFormulaInput] = useState('=B2*C2');
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeData = sheets[activeSheet] || [[]];

  const loadWorkbookFile = async (f: File) => {
    try {
      const parsed = await parseSpreadsheetFile(f);
      setTitle(f.name.replace(/\.(xlsx|csv)$/i, ''));
      setSheetNames(parsed.sheetNames);
      setActiveSheet(parsed.activeSheet);
      setSheets(parsed.sheets);
      setSelectedCell({ r: 0, c: 0 });
      setFormulaInput(String(parsed.data[0]?.[0] ?? ''));
      onToast('success', `Loaded "${f.name}" (${parsed.sheetNames.length} sheet(s))`);
    } catch (err: any) {
      onToast('error', err?.message || 'Could not parse spreadsheet');
    }
  };

  useEffect(() => {
    if (initialFile) loadWorkbookFile(initialFile);
  }, [initialFile]);

  const selectCell = (r: number, c: number) => {
    setSelectedCell({ r, c });
    const raw = activeData[r]?.[c];
    setFormulaInput(raw !== undefined && raw !== null ? String(raw) : '');
  };

  const commitCellValue = (val: string) => {
    setFormulaInput(val);
    setSheets((prev) => {
      const copy = (prev[activeSheet] || []).map((row) => [...row]);
      while (copy.length <= selectedCell.r) copy.push(Array(Math.max(8, copy[0]?.length || 8)).fill(''));
      while (copy[selectedCell.r].length <= selectedCell.c) copy[selectedCell.r].push('');
      const num = /^-?\d+(\.\d+)?$/.test(val.trim()) ? Number(val.trim()) : null;
      copy[selectedCell.r][selectedCell.c] = val.startsWith('=') ? val : num !== null ? num : val;
      return { ...prev, [activeSheet]: copy };
    });
  };

  const displayValue = (raw: string | number): string => {
    if (typeof raw === 'string' && raw.startsWith('=')) {
      return String(evaluateCellFormula(raw, activeData));
    }
    return String(raw ?? '');
  };

  const handleAddRow = () => {
    setSheets((prev) => {
      const current = prev[activeSheet] || [[]];
      const cols = current[0]?.length || 8;
      return { ...prev, [activeSheet]: [...current, Array(cols).fill('')] };
    });
  };

  const handleSortCol = () => {
    setSheets((prev) => ({
      ...prev,
      [activeSheet]: sortSheetRows(prev[activeSheet] || [], selectedCell.c, true, true),
    }));
    onToast('info', `Sorted by column ${columnIndexToLetter(selectedCell.c)}`);
  };

  const handleDedup = () => {
    const res = removeDuplicateRows(activeData, true);
    setSheets((prev) => ({ ...prev, [activeSheet]: res.data }));
    onToast('success', `Removed ${res.removedCount} duplicate row(s).`);
  };

  const handleExport = async (fmt: 'xlsx' | 'csv' | 'pdf', mode: 'save' | 'share' | 'upload') => {
    setBusy(true);
    try {
      let blob: Blob;
      let outName = `${title || 'sheet'}.${fmt}`;
      if (fmt === 'xlsx') {
        blob = exportMultiSheetWorkbookToBlob(sheets, sheetNames);
      } else if (fmt === 'csv') {
        blob = exportDataToCsvBlob(activeData);
      } else {
        const pdfBytes = await convertSpreadsheetToPdf(activeData, title || 'Spreadsheet');
        blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
      }

      if (mode === 'save') {
        const saved = await saveFileToDevice(blob, outName);
        onToast('success', `Saved to ${saved.path}`);
      } else if (mode === 'share') {
        await shareDocumentFile(blob, outName, outName);
      } else {
        const uploaded = await apiClient.uploadDocument(new File([blob], outName, { type: blob.type }));
        onToast('success', `Uploaded "${uploaded.filename}" to vault.`);
      }

      await offlineStore.appendHistory({
        kind: 'sheet_export',
        title: `Exported ${outName}`,
        sourceFormat: 'xlsx',
        targetFormat: fmt,
        sizeBytes: blob.size,
        status: 'completed',
      });
    } catch (err: any) {
      onToast('error', err?.message || 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCloudProject = async () => {
    if (!isOnline) {
      onToast('error', 'Saving cloud project requires internet connectivity.');
      return;
    }
    setBusy(true);
    try {
      const proj = await apiClient.createProject({
        title: title || 'Mobile Workbook',
        project_type: 'sheets',
        data: { sheetNames, activeSheet, sheets },
        note: 'Saved from OmniDoc Mobile Sheets',
      });
      onToast('success', `Synced Cloud Project "${proj.title}" (v${proj.version})`);
    } catch (err: any) {
      onToast('error', err?.message || 'Cloud sync failed');
    } finally {
      setBusy(false);
    }
  };

  const colCount = Math.min(12, activeData[0]?.length || 8);
  const visibleRows = activeData.slice(0, 40);
  const cellRefLabel = `${columnIndexToLetter(selectedCell.c)}${selectedCell.r + 1}`;

  return (
    <div className="space-y-3 pb-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadWorkbookFile(f);
          e.target.value = '';
        }}
      />

      {/* Top Controls */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 h-10 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="h-10 px-3 rounded-xl bg-slate-800 text-xs font-semibold flex items-center gap-1.5"
        >
          <FilePlus2 className="w-4 h-4 text-emerald-400" /> Open
        </button>
        <button
          onClick={handleSaveCloudProject}
          disabled={!isOnline || busy}
          className="h-10 px-3 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center gap-1 disabled:opacity-40"
        >
          <CloudUpload className="w-4 h-4" /> Sync
        </button>
      </div>

      {/* Formula Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 flex items-center gap-2">
        <span className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 font-mono text-xs font-bold shrink-0">
          {cellRefLabel}
        </span>
        <input
          type="text"
          value={formulaInput}
          onChange={(e) => commitCellValue(e.target.value)}
          placeholder="Value or =SUM(B2:B5)"
          className="flex-1 h-9 px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Sheet Tabs + Tools */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1">
        <div className="flex gap-1.5">
          {sheetNames.map((name) => (
            <button
              key={name}
              onClick={() => setActiveSheet(name)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 ${
                activeSheet === name ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button onClick={handleAddRow} className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-[11px] flex items-center gap-1">
            <Plus className="w-3 h-3" /> Row
          </button>
          <button onClick={handleSortCol} className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-[11px] flex items-center gap-1">
            <SortAsc className="w-3 h-3" /> Sort
          </button>
          <button onClick={handleDedup} className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-[11px] flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Dedup
          </button>
        </div>
      </div>

      {/* Touch-Friendly Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-auto max-h-[320px]">
        <table className="border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-950 z-10">
            <tr>
              <th className="w-9 border border-slate-800 py-1.5 text-slate-500 font-mono">#</th>
              {Array.from({ length: colCount }).map((_, c) => (
                <th key={c} className="min-w-[84px] border border-slate-800 py-1.5 px-2 text-slate-400 font-mono">
                  {columnIndexToLetter(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, r) => (
              <tr key={r}>
                <td className="border border-slate-800 bg-slate-950 text-center text-slate-500 font-mono py-1.5">
                  {r + 1}
                </td>
                {Array.from({ length: colCount }).map((_, c) => {
                  const isSelected = selectedCell.r === r && selectedCell.c === c;
                  const raw = row[c] ?? '';
                  return (
                    <td
                      key={c}
                      onClick={() => selectCell(r, c)}
                      className={`border border-slate-800 px-2 py-1.5 max-w-[140px] truncate cursor-pointer ${
                        isSelected ? 'bg-emerald-500/20 ring-1 ring-inset ring-emerald-400 text-white' : 'text-slate-200'
                      }`}
                    >
                      {displayValue(raw)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Export / Share / Upload Actions */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
        <p className="text-[11px] text-slate-400 font-semibold uppercase">Export Workbook</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            disabled={busy}
            onClick={() => handleExport('xlsx', 'save')}
            className="h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-200 text-xs font-semibold flex items-center justify-center gap-1"
          >
            <Download className="w-3.5 h-3.5" /> XLSX
          </button>
          <button
            disabled={busy}
            onClick={() => handleExport('csv', 'save')}
            className="h-10 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" /> CSV
          </button>
          <button
            disabled={busy}
            onClick={() => handleExport('pdf', 'save')}
            className="h-10 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1"
          >
            <Download className="w-3.5 h-3.5 text-rose-400" /> PDF
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={busy}
            onClick={() => handleExport('xlsx', 'share')}
            className="h-10 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Share2 className="w-4 h-4 text-indigo-400" /> Share XLSX
          </button>
          <button
            disabled={busy || !isOnline}
            onClick={() => handleExport('xlsx', 'upload')}
            className="h-10 rounded-xl bg-emerald-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Upload className="w-4 h-4" /> Upload to Vault
          </button>
        </div>
      </div>
    </div>
  );
};
