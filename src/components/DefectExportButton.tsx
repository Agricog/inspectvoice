/**
 * Feature 10: Defect Export Button (replaces existing DefectExportButton.tsx)
 * src/components/DefectExportButton.tsx
 *
 * Adds "Sealed Excel Bundle" option alongside existing Excel/CSV.
 * Same API, same props, same styling — just one more menu item.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, Shield, ChevronDown, Loader2, AlertTriangle, Check } from 'lucide-react';
import { secureFetch } from '@hooks/useFetch';
import {
  generateExcelWorkbook,
  generateCsvExport,
  type DefectExportData,
} from '@services/defectExport';
import {
  createSealedDefectExport,
  type SealedExportFilters,
} from '@services/sealedExport';
import { VerificationBadge } from './VerificationBadge';

// =============================================
// TYPES
// =============================================

type ExportFormat = 'xlsx' | 'csv' | 'sealed';
type ExportStatus = 'idle' | 'loading' | 'success' | 'error';

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
  const [activeFormat, setActiveFormat] = useState<ExportFormat | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastBundleId, setLastBundleId] = useState<string | null>(null);
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
    setActiveFormat(format);
    setErrorMsg('');
    setLastBundleId(null);

    try {
      if (format === 'sealed') {
        // ── Sealed export (server-side) ──
        const sealedFilters: SealedExportFilters = {
          status: filters?.status,
          severity: filters?.severity,
          siteId: filters?.siteId,
        };
        const bundleId = await createSealedDefectExport(sealedFilters);
        setLastBundleId(bundleId);
        setStatus('success');
        setTimeout(() => { setStatus('idle'); setActiveFormat(null); }, 5000);
      } else {
        // ── Client-side export (existing logic) ──
        const params = new URLSearchParams();
        if (filters?.status) params.set('status', filters.status);
        if (filters?.severity) params.set('severity', filters.severity);
        if (filters?.siteId) params.set('site_id', filters.siteId);

        const queryStr = params.toString();
        const url = `/api/v1/defects/export${queryStr ? `?${queryStr}` : ''}`;

        const raw = await secureFetch(url);
        const response = raw as Response;

        if (!response.ok) {
          const body = await response.json().catch(() => null) as Record<string, string> | null;
          throw new Error(body?.error ?? `Export failed (${response.status})`);
        }

        const result = await response.json() as { success: boolean; data: DefectExportData };
        if (!result.success || !result.data) throw new Error('Invalid response from export endpoint');

        const { data } = result;
        if (data.defects.length === 0) throw new Error('No defects to export. Try adjusting your filters.');

        if (format === 'xlsx') {
          generateExcelWorkbook(data);
        } else {
          generateCsvExport(data.defects);
        }

        setStatus('idle');
        setActiveFormat(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      setErrorMsg(message);
      setStatus('error');
      setTimeout(() => { setStatus('idle'); setErrorMsg(''); setActiveFormat(null); }, 5000);
    }
  }, [filters]);

  const isLoading = status === 'loading';
  const isSealed = activeFormat === 'sealed';

  return (
    <div ref={menuRef} className="relative">
      {/* Main button */}
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        disabled={isLoading}
        className="inline-flex items-center gap-1.5 px-3 py-2 bg-iv-surface border border-iv-border rounded-lg text-sm font-medium text-iv-text hover:bg-iv-surface-2 hover:border-iv-accent/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Export defects"
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : status === 'success' && isSealed ? (
          <Check className="w-4 h-4 text-emerald-400" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {isLoading && isSealed ? 'Sealing…' : isLoading ? 'Exporting…' : status === 'success' && isSealed ? 'Sealed' : 'Export'}
        <ChevronDown className="w-3 h-3 text-iv-muted" />
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-iv-surface border border-iv-border rounded-xl shadow-lg shadow-black/20 z-50 overflow-hidden">
          {/* Excel */}
          <button
            type="button"
            onClick={() => void handleExport('xlsx')}
            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-iv-surface-2 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-iv-text">Excel Workbook</p>
              <p className="text-2xs text-iv-muted mt-0.5">Summary + All Defects + per-site sheets</p>
            </div>
          </button>

          <div className="border-t border-iv-border" />

          {/* CSV */}
          <button
            type="button"
            onClick={() => void handleExport('csv')}
            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-iv-surface-2 transition-colors"
          >
            <FileText className="w-4 h-4 text-iv-accent mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-iv-text">CSV (Flat Table)</p>
              <p className="text-2xs text-iv-muted mt-0.5">Master defect list for import into other systems</p>
            </div>
          </button>

          <div className="border-t border-iv-border" />

          {/* Sealed (new) */}
          <button
            type="button"
            onClick={() => void handleExport('sealed')}
            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-iv-surface-2 transition-colors"
          >
            <Shield className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-400">Sealed Excel Bundle</p>
              <p className="text-2xs text-iv-muted mt-0.5">Tamper-evident .zip with SHA-256 manifest</p>
              <p className="text-2xs text-blue-400/70 mt-0.5">For council submissions &amp; procurement</p>
            </div>
          </button>
        </div>
      )}

      {/* Verification badge after sealed download */}
      {status === 'success' && lastBundleId && (
        <div className="absolute right-0 top-full mt-1 z-50">
          <VerificationBadge bundleId={lastBundleId} />
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
