/**
 * InspectVoice — Defect Export Button
 * Fetches all defects and generates Excel workbook or CSV download.
 *
 * Placed in DefectTracker page header alongside the refresh button.
 *
 * Two export modes:
 *   - Excel (.xlsx) — multi-sheet workbook with Summary, All Defects, per-site sheets
 *   - CSV (.csv) — flat master table for quick import
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';
import { secureFetch } from '@hooks/useFetch';
import {
  generateExcelWorkbook,
  generateCsvExport,
  type DefectExportData,
} from '@services/defectExport';

// =============================================
// TYPES
// =============================================

type ExportFormat = 'xlsx' | 'csv';
type ExportStatus = 'idle' | 'loading' | 'error';

interface ExportFilters {
  status?: string;
  severity?: string;
  siteId?: string;
}

// =============================================
// COMPONENT
// =============================================

export function DefectExportButton({
  filters,
}: {
  filters?: ExportFilters;
}): JSX.Element {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;

    function handleClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const handleExport = useCallback(async (format: ExportFormat) => {
    setMenuOpen(false);
    setStatus('loading');
    setErrorMsg('');

    try {
      // Build query params from current filters
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.severity) params.set('severity', filters.severity);
      if (filters?.siteId) params.set('site_id', filters.siteId);

      const queryStr = params.toString();
      const url = `/api/v1/defects/export${queryStr ? `?${queryStr}` : ''}`;

      const response = await secureFetch(url);

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const msg = (body as Record<string, string> | null)?.error ?? `Export failed (${response.status})`;
        throw new Error(msg);
      }

      const result = await response.json() as { success: boolean; data: DefectExportData };

      if (!result.success || !result.data) {
        throw new Error('Invalid response from export endpoint');
      }

      const { data } = result;

      if (data.defects.length === 0) {
        throw new Error('No defects to export. Try adjusting your filters.');
      }

      // Generate file
      if (format === 'xlsx') {
        generateExcelWorkbook(data);
      } else {
        generateCsvExport(data.defects);
      }

      setStatus('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      setErrorMsg(message);
      setStatus('error');

      // Auto-clear error after 5 seconds
      setTimeout(() => {
        setStatus('idle');
        setErrorMsg('');
      }, 5000);
    }
  }, [filters]);

  return (
    <div ref={menuRef} className="relative">
      {/* Main button */}
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        disabled={status === 'loading'}
        className="inline-flex items-center gap-1.5 px-3 py-2 bg-iv-surface border border-iv-border rounded-lg text-sm font-medium text-iv-text hover:bg-iv-surface-2 hover:border-iv-accent/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Export defects"
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        {status === 'loading' ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {status === 'loading' ? 'Exporting…' : 'Export'}
        <ChevronDown className="w-3 h-3 text-iv-muted" />
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-iv-surface border border-iv-border rounded-xl shadow-lg shadow-black/20 z-50 overflow-hidden">
          <button
            type="button"
            onClick={() => void handleExport('xlsx')}
            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-iv-surface-2 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-iv-text">Excel Workbook</p>
              <p className="text-2xs text-iv-muted mt-0.5">
                Summary + All Defects + per-site sheets
              </p>
            </div>
          </button>

          <div className="border-t border-iv-border" />

          <button
            type="button"
            onClick={() => void handleExport('csv')}
            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-iv-surface-2 transition-colors"
          >
            <FileText className="w-4 h-4 text-iv-accent mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-iv-text">CSV (Flat Table)</p>
              <p className="text-2xs text-iv-muted mt-0.5">
                Master defect list for import into other systems
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Error toast */}
      {status === 'error' && errorMsg && (
        <div className="absolute right-0 top-full mt-1 w-64 flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl z-50">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400">{errorMsg}</p>
        </div>
      )}
    </div>
  );
}

export default DefectExportButton;
