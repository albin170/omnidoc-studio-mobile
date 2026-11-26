import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CloudUpload,
  Download,
  FilePlus2,
  Minus,
  Plus,
  RotateCcw,
  Share2,
  SortAsc,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  columnIndexToLetter,
  convertSpreadsheetToPdf,
  evaluateCellFormula,
  exportDataToCsvBlob,
  exportMultiSheetWorkbookToBlob,
  parseSpreadsheetFile,
  removeDuplicateRows,
  sanitizeWorkbookData,
  sortSheetRows,
} from '../engines/sheetService';
import { apiClient } from '../services/apiClient';
import { saveFileToDevice, shareDocumentFile } from '../services/nativeBridge';
import { offlineStore } from '../services/offlineStore';
import { CloudProjectDetail } from '../types';

export interface SheetCellStyle {
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface SheetsStudioScreenProps {
  initialFile?: File | null;
  initialProject?: CloudProjectDetail | null;
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

function shiftCellStylesAfterRowDelete(
  sheetStyles: Record<string, SheetCellStyle>,
  deletedRow: number
): Record<string, SheetCellStyle> {
  const next: Record<string, SheetCellStyle> = {};
  for (const [key, style] of Object.entries(sheetStyles)) {
    const [rStr, cStr] = key.split('_');
    const r = Number(rStr);
    const c = Number(cStr);
    if (isNaN(r) || isNaN(c) || r === deletedRow) continue;
    const newRow = r > deletedRow ? r - 1 : r;
    next[`${newRow}_${c}`] = style;
  }
  return next;
}

function shiftCellStylesAfterColDelete(
  sheetStyles: Record<string, SheetCellStyle>,
  deletedCol: number
): Record<string, SheetCellStyle> {
  const next: Record<string, SheetCellStyle> = {};
  for (const [key, style] of Object.entries(sheetStyles)) {
    const [rStr, cStr] = key.split('_');
    const r = Number(rStr);
    const c = Number(cStr);
    if (isNaN(r) || isNaN(c) || c === deletedCol) continue;
    const newCol = c > deletedCol ? c - 1 : c;
    next[`${r}_${newCol}`] = style;
  }
  return next;
}

export const SheetsStudioScreen: React.FC<SheetsStudioScreenProps> = ({
  initialFile,
  initialProject,
  onToast,
}) => {
  const { isOnline } = useAuth();
  const [title, setTitle] = useState('Mobile_Workbook');
  const [sheetNames, setSheetNames] = useState<string[]>(['Sheet1']);
  const [activeSheet, setActiveSheet] = useState('Sheet1');
  const [sheets, setSheets] = useState<Record<string, (string | number)[][]>>({ Sheet1: makeBlankSheet() });
  const [cellStyles, setCellStyles] = useState<Record<string, Record<string, SheetCellStyle>>>({});
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number }>({ r: 1, c: 3 });
  const [formulaInput, setFormulaInput] = useState('=B2*C2');
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cloudProjectId, setCloudProjectId] = useState<string | null>(null);
  const [cloudVersion, setCloudVersion] = useState<number | undefined>(undefined);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeData = sheets[activeSheet] || [[]];
  const activeSheetStyles = cellStyles[activeSheet] || {};
  const activeCellKey = `${selectedCell.r}_${selectedCell.c}`;
  const activeCellStyle = activeSheetStyles[activeCellKey] || {};

  const loadWorkbookFile = useCallback(
    async (f: File) => {
      try {
        const parsed = await parseSpreadsheetFile(f);
        setTitle(f.name.replace(/\.(xlsx|xls|csv)$/i, ''));
        setSheetNames(parsed.sheetNames);
        setActiveSheet(parsed.activeSheet);
        setSheets(parsed.sheets);
        setCellStyles({});
        setSelectedCell({ r: 0, c: 0 });
        setFormulaInput(String(parsed.data[0]?.[0] ?? ''));
        setCloudProjectId(null);
        setCloudVersion(undefined);
        onToast('success', `Loaded "${f.name}" (${parsed.sheetNames.length} sheet(s))`);
      } catch (err: any) {
        onToast('error', err?.message || 'Could not parse spreadsheet');
      }
    },
    [onToast]
  );

  useEffect(() => {
    if (initialFile) loadWorkbookFile(initialFile);
  }, [initialFile, loadWorkbookFile]);

  useEffect(() => {
    if (!initialProject) return;
    const data = initialProject.data || {};
    const sanitizedSheets = data.sheets ? sanitizeWorkbookData(data.sheets) : { Sheet1: makeBlankSheet() };
    const names =
      Array.isArray(data.sheetNames) && data.sheetNames.length > 0
        ? data.sheetNames.filter((n: unknown): n is string => typeof n === 'string' && Boolean(sanitizedSheets[n]))
        : Object.keys(sanitizedSheets);
    const validNames = names.length > 0 ? names : ['Sheet1'];
    const firstActive =
      typeof data.activeSheet === 'string' && validNames.includes(data.activeSheet) ? data.activeSheet : validNames[0];

    setTitle(initialProject.title || 'Cloud Workbook');
    setSheetNames(validNames);
    setActiveSheet(firstActive);
    setSheets(sanitizedSheets[firstActive] ? sanitizedSheets : { Sheet1: makeBlankSheet() });
    setCellStyles(data.cellStyles && typeof data.cellStyles === 'object' ? sanitizeWorkbookData(data.cellStyles) : {});
    setSelectedCell({ r: 0, c: 0 });
    setFormulaInput(String(sanitizedSheets[firstActive]?.[0]?.[0] ?? ''));
    setCloudProjectId(initialProject.id);
    setCloudVersion(initialProject.version);
    setConfirmReset(false);
    onToast('info', `Loaded workbook "${initialProject.title}" (v${initialProject.version})`);
  }, [initialProject, onToast]);

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

  const toggleBold = () => {
    setCellStyles((prev) => {
      const sheetDict = { ...(prev[activeSheet] || {}) };
      const current = sheetDict[activeCellKey] || {};
      sheetDict[activeCellKey] = { ...current, bold: !current.bold };
      return { ...prev, [activeSheet]: sheetDict };
    });
  };

  const setAlignment = (align: 'left' | 'center' | 'right') => {
    setCellStyles((prev) => {
      const sheetDict = { ...(prev[activeSheet] || {}) };
      const current = sheetDict[activeCellKey] || {};
      sheetDict[activeCellKey] = { ...current, align: current.align === align ? undefined : align };
      return { ...prev, [activeSheet]: sheetDict };
    });
  };

  const handleAddRow = () => {
    setSheets((prev) => {
      const current = prev[activeSheet] || [[]];
      const cols = Math.max(1, current[0]?.length || 8);
      return { ...prev, [activeSheet]: [...current, Array(cols).fill('')] };
    });
  };

  const handleDeleteRow = () => {
    if (activeData.length <= 1) {
      onToast('info', 'Cannot delete the last remaining row.');
      return;
    }
    const targetRow = Math.min(selectedCell.r, activeData.length - 1);
    const nextRows = activeData.filter((_, idx) => idx !== targetRow);
    const nextRowIdx = Math.max(0, Math.min(targetRow, nextRows.length - 1));

    setSheets((prev) => ({ ...prev, [activeSheet]: nextRows }));
    setCellStyles((prev) => ({
      ...prev,
      [activeSheet]: shiftCellStylesAfterRowDelete(prev[activeSheet] || {}, targetRow),
    }));
    setSelectedCell({ r: nextRowIdx, c: selectedCell.c });
    setFormulaInput(String(nextRows[nextRowIdx]?.[selectedCell.c] ?? ''));
  };

  const handleAddCol = () => {
    setSheets((prev) => {
      const current = prev[activeSheet] || [[]];
      const targetLen = Math.max(1, ...current.map((r) => r.length)) + 1;
      const updated = current.map((row) => {
        const copy = [...row];
        while (copy.length < targetLen) copy.push('');
        return copy;
      });
      return { ...prev, [activeSheet]: updated };
    });
  };

  const handleDeleteCol = () => {
    const currentColCount = Math.max(1, ...activeData.map((r) => r.length));
    if (currentColCount <= 1) {
      onToast('info', 'Cannot delete the last remaining column.');
      return;
    }
    const targetCol = Math.min(selectedCell.c, currentColCount - 1);
    const nextRows = activeData.map((row) => row.filter((_, idx) => idx !== targetCol));
    const nextColIdx = Math.max(0, Math.min(targetCol, currentColCount - 2));

    setSheets((prev) => ({ ...prev, [activeSheet]: nextRows }));
    setCellStyles((prev) => ({
      ...prev,
      [activeSheet]: shiftCellStylesAfterColDelete(prev[activeSheet] || {}, targetCol),
    }));
    setSelectedCell({ r: selectedCell.r, c: nextColIdx });
    setFormulaInput(String(nextRows[selectedCell.r]?.[nextColIdx] ?? ''));
  };

  const handleAddSheet = () => {
    let idx = sheetNames.length + 1;
    let newName = `Sheet${idx}`;
    while (sheetNames.includes(newName)) {
      idx += 1;
      newName = `Sheet${idx}`;
    }
    const blank = Array.from({ length: 16 }, () => Array(8).fill(''));
    setSheets((prev) => ({ ...prev, [newName]: blank }));
    setSheetNames((prev) => [...prev, newName]);
    setActiveSheet(newName);
    setSelectedCell({ r: 0, c: 0 });
    setFormulaInput('');
  };

  const handleConfirmReset = () => {
    const fresh = makeBlankSheet();
    setTitle('Mobile_Workbook');
    setSheetNames(['Sheet1']);
    setActiveSheet('Sheet1');
    setSheets({ Sheet1: fresh });
    setCellStyles({});
    setSelectedCell({ r: 1, c: 3 });
    setFormulaInput(String(fresh[1][3]));
    setCloudProjectId(null);
    setCloudVersion(undefined);
    setConfirmReset(false);
    onToast('info', 'Workbook reset to blank starter template.');
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
      const outName = `${title || 'sheet'}.${fmt}`;
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
      const payloadData = { sheetNames, activeSheet, sheets, cellStyles };
      if (cloudProjectId) {
        const updated = await apiClient.updateProject(cloudProjectId, {
          title: title || 'Mobile Workbook',
          data: payloadData,
          expected_version: cloudVersion,
          note: 'Updated from OmniDoc Mobile Sheets',
        });
        setCloudVersion(updated.version);
        onToast('success', `Updated Cloud Project "${updated.title}" (v${updated.version})`);
      } else {
        const proj = await apiClient.createProject({
          title: title || 'Mobile Workbook',
          project_type: 'sheets',
          data: payloadData,
          note: 'Saved from OmniDoc Mobile Sheets',
        });
        setCloudProjectId(proj.id);
        setCloudVersion(proj.version);
        onToast('success', `Synced Cloud Project "${proj.title}" (v${proj.version})`);
      }
    } catch (err: any) {
      onToast('error', err?.message || 'Cloud sync failed');
    } finally {
      setBusy(false);
    }
  };

  const colCount = Math.min(50, Math.max(1, ...activeData.map((r) => r.length)));
  const visibleRows = activeData.slice(0, 100);
  const cellRefLabel = `${columnIndexToLetter(selectedCell.c)}${selectedCell.r + 1}`;

  return (
    <div className="space-y-3 pb-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
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
          aria-label="Workbook title"
          className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-100 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="h-10 px-2.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1 shrink-0"
          title="Clear / Reset workbook"
        >
          <RotateCcw className="w-3.5 h-3.5 text-amber-400" /> Clear
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="h-10 px-2.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1 shrink-0"
        >
          <FilePlus2 className="w-4 h-4 text-emerald-400" /> Open
        </button>
        <button
          type="button"
          onClick={handleSaveCloudProject}
          disabled={!isOnline || busy}
          className="h-10 px-3 rounded-xl bg-indigo-600 text-xs font-semibold text-white flex items-center gap-1 shrink-0 disabled:opacity-40"
        >
          <CloudUpload className="w-4 h-4" />
          <span>{cloudProjectId ? 'Update' : 'Sync'}</span>
        </button>
      </div>

      {cloudProjectId && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-200">
          <span>Linked to Cloud Workbook (v{cloudVersion ?? 1})</span>
          <span className="font-mono text-[10px] text-emerald-300">SHEETS</span>
        </div>
      )}

      {/* Inline Reset Confirmation */}
      {confirmReset && (
        <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/40 flex items-center justify-between gap-2 text-xs">
          <span className="text-amber-100 font-medium">Reset workbook to blank? Current unsaved changes will be lost.</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleConfirmReset}
              className="px-2.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-semibold"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
          aria-label="Cell value or formula"
          className="flex-1 h-9 px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Formatting & Structure Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-1.5 flex items-center gap-1 overflow-x-auto text-xs">
        <button
          type="button"
          onClick={toggleBold}
          className={`h-8 px-2.5 rounded-lg flex items-center justify-center shrink-0 ${
            activeCellStyle.bold ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
          title="Bold cell"
          aria-label="Bold cell"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setAlignment('left')}
          className={`h-8 px-2 rounded-lg flex items-center justify-center shrink-0 ${
            activeCellStyle.align === 'left' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
          title="Align left"
          aria-label="Align cell left"
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setAlignment('center')}
          className={`h-8 px-2 rounded-lg flex items-center justify-center shrink-0 ${
            activeCellStyle.align === 'center' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
          title="Align center"
          aria-label="Align cell center"
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setAlignment('right')}
          className={`h-8 px-2 rounded-lg flex items-center justify-center shrink-0 ${
            activeCellStyle.align === 'right' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
          title="Align right"
          aria-label="Align cell right"
        >
          <AlignRight className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-slate-700 mx-0.5 shrink-0" />

        <button
          type="button"
          onClick={handleAddRow}
          className="h-8 px-2 rounded-lg bg-slate-800 text-slate-200 text-[11px] flex items-center gap-1 shrink-0"
        >
          <Plus className="w-3 h-3 text-emerald-400" /> Row
        </button>
        <button
          type="button"
          onClick={handleDeleteRow}
          disabled={activeData.length <= 1}
          className="h-8 px-2 rounded-lg bg-slate-800 text-slate-200 text-[11px] flex items-center gap-1 shrink-0 disabled:opacity-40"
        >
          <Minus className="w-3 h-3 text-rose-400" /> Row
        </button>
        <button
          type="button"
          onClick={handleAddCol}
          className="h-8 px-2 rounded-lg bg-slate-800 text-slate-200 text-[11px] flex items-center gap-1 shrink-0"
        >
          <Plus className="w-3 h-3 text-emerald-400" /> Col
        </button>
        <button
          type="button"
          onClick={handleDeleteCol}
          disabled={colCount <= 1}
          className="h-8 px-2 rounded-lg bg-slate-800 text-slate-200 text-[11px] flex items-center gap-1 shrink-0 disabled:opacity-40"
        >
          <Minus className="w-3 h-3 text-rose-400" /> Col
        </button>

        <div className="w-px h-5 bg-slate-700 mx-0.5 shrink-0" />

        <button
          type="button"
          onClick={handleSortCol}
          className="h-8 px-2 rounded-lg bg-slate-800 text-slate-200 text-[11px] flex items-center gap-1 shrink-0"
        >
          <SortAsc className="w-3 h-3" /> Sort
        </button>
        <button
          type="button"
          onClick={handleDedup}
          className="h-8 px-2 rounded-lg bg-slate-800 text-slate-200 text-[11px] flex items-center gap-1 shrink-0"
        >
          <Sparkles className="w-3 h-3" /> Dedup
        </button>
      </div>

      {/* Sheet Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {sheetNames.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              setActiveSheet(name);
              setSelectedCell({ r: 0, c: 0 });
              setFormulaInput(String(sheets[name]?.[0]?.[0] ?? ''));
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 ${
              activeSheet === name ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'
            }`}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          onClick={handleAddSheet}
          className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold flex items-center gap-1 shrink-0"
          title="Add worksheet"
        >
          <Plus className="w-3.5 h-3.5" /> Sheet
        </button>
      </div>

      {/* Touch-Friendly Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-auto max-h-[320px]">
        <table className="border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-950 z-10">
            <tr>
              <th className="w-9 border border-slate-800 py-1.5 text-slate-500 font-mono">#</th>
              {Array.from({ length: colCount }).map((_, c) => (
                <th
                  key={c}
                  className={`min-w-[84px] border border-slate-800 py-1.5 px-2 font-mono ${
                    selectedCell.c === c ? 'text-emerald-300 bg-emerald-950/30' : 'text-slate-400'
                  }`}
                >
                  {columnIndexToLetter(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, r) => (
              <tr key={r}>
                <td
                  className={`border border-slate-800 bg-slate-950 text-center font-mono py-1.5 ${
                    selectedCell.r === r ? 'text-emerald-300' : 'text-slate-500'
                  }`}
                >
                  {r + 1}
                </td>
                {Array.from({ length: colCount }).map((_, c) => {
                  const isSelected = selectedCell.r === r && selectedCell.c === c;
                  const raw = row[c] ?? '';
                  const cStyle = activeSheetStyles[`${r}_${c}`] || {};
                  const alignClass =
                    cStyle.align === 'center'
                      ? 'text-center'
                      : cStyle.align === 'right'
                      ? 'text-right'
                      : 'text-left';
                  return (
                    <td
                      key={c}
                      onClick={() => selectCell(r, c)}
                      className={`border border-slate-800 px-2 py-1.5 max-w-[140px] truncate cursor-pointer ${alignClass} ${
                        cStyle.bold ? 'font-bold' : ''
                      } ${
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
            type="button"
            disabled={busy}
            onClick={() => handleExport('xlsx', 'save')}
            className="h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-200 text-xs font-semibold flex items-center justify-center gap-1"
          >
            <Download className="w-3.5 h-3.5" /> XLSX
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleExport('csv', 'save')}
            className="h-10 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" /> CSV
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleExport('pdf', 'save')}
            className="h-10 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1"
          >
            <Download className="w-3.5 h-3.5 text-rose-400" /> PDF
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => handleExport('xlsx', 'share')}
            className="h-10 rounded-xl bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Share2 className="w-4 h-4 text-indigo-400" /> Share XLSX
          </button>
          <button
            type="button"
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
