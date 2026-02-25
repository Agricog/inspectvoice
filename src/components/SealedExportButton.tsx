/**
 * InspectVoice — Sealed Export Button
 * Reusable component to create tamper-evident export bundles.
 *
 * Supports three export types:
 *   - defect_export: Excel defect bundle
 *   - pdf_report: Inspection PDF bundle
 *   - claims_pack: Incident claims pack bundle
 *
 * After creation, downloads the .zip bundle and shows the
 * verification URL for sharing with third parties.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useCallback } from 'react';
import { Shield, Loader2, Check, Copy, ExternalLink } from 'lucide-react';
import { getAuthToken } from '../utils/authToken';

// =============================================
// TYPES
// =============================================

type ExportType = 'defect_export' | 'pdf_report' | 'claims_pack';

interface SealedExportButtonProps {
  /** Which type of sealed export to create */
  readonly exportType: ExportType;
  /** Source entity ID — inspection ID for pdf_report, incident ID for claims_pack, null for defect_export */
  readonly sourceId?: string;
  /** Optional query string for defect export filters (e.g. '?severity=high&site_id=abc') */
  readonly filterParams?: string;
  /** Button size variant */
  readonly size?: 'sm' | 'md';
  /** Optional className override */
  readonly className?: string;
}

// =============================================
// CONSTANTS
// =============================================

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;
const APP_URL = import.meta.env.VITE_APP_URL as string | undefined;

const ENDPOINTS: Record<ExportType, (sourceId?: string) => string> = {
  defect_export: () => '/api/v1/sealed-exports/defects',
  pdf_report: (id) => `/api/v1/sealed-exports/inspections/${id}/pdf`,
  claims_pack: (id) => `/api/v1/sealed-exports/incidents/${id}/claims-pack`,
};

const LABELS: Record<ExportType, string> = {
  defect_export: 'Sealed Defect Export',
  pdf_report: 'Sealed PDF Report',
  claims_pack: 'Sealed Claims Pack',
};

// =============================================
// COMPONENT
// =============================================

export default function SealedExportButton({
  exportType,
  sourceId,
  filterParams,
  size = 'md',
  className = '',
}: SealedExportButtonProps) {
  const [state, setState] = useState<'idle' | 'creating' | 'done' | 'error'>('idle');
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [sha256, setSha256] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const verifyUrl = bundleId
    ? `${APP_URL ?? window.location.origin}/verify/${bundleId}`
    : null;

  const handleCreate = useCallback(async () => {
    setState('creating');
    setErrorMessage(null);

    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Not authenticated');

      const endpoint = ENDPOINTS[exportType](sourceId);
      const url = `${API_BASE}${endpoint}${filterParams ?? ''}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/zip',
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(errorBody?.error?.message ?? `Export failed (${response.status})`);
      }

      // Extract bundle metadata from headers
      const responseBundleId = response.headers.get('X-Bundle-Id');
      const responseHash = response.headers.get('X-Manifest-SHA256');

      if (responseBundleId) setBundleId(responseBundleId);
      if (responseHash) setSha256(responseHash);

      // Download the zip
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `InspectVoice_Bundle_${responseBundleId ?? 'export'}.zip`;
      link.click();
      URL.revokeObjectURL(downloadUrl);

      setState('done');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Export failed');
      setState('error');
    }
  }, [exportType, sourceId, filterParams]);

  const handleCopyUrl = useCallback(async () => {
    if (!verifyUrl) return;
    await navigator.clipboard.writeText(verifyUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [verifyUrl]);

  const sizeClasses = size === 'sm'
    ? 'px-3 py-1.5 text-xs gap-1.5'
    : 'px-4 py-2 text-sm gap-2';

  // ── Idle State ──
  if (state === 'idle') {
    return (
      <button
        type="button"
        onClick={handleCreate}
        className={`inline-flex items-center ${sizeClasses} font-medium rounded-lg
          bg-slate-800 text-white hover:bg-slate-700
          transition-colors ${className}`}
      >
        <Shield className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        {LABELS[exportType]}
      </button>
    );
  }

  // ── Creating State ──
  if (state === 'creating') {
    return (
      <button
        type="button"
        disabled
        className={`inline-flex items-center ${sizeClasses} font-medium rounded-lg
          bg-slate-200 text-slate-500 cursor-wait ${className}`}
      >
        <Loader2 className={`${size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} animate-spin`} />
        Creating sealed bundle…
      </button>
    );
  }

  // ── Error State ──
  if (state === 'error') {
    return (
      <div className={`space-y-2 ${className}`}>
        <p className="text-xs text-red-600">{errorMessage}</p>
        <button
          type="button"
          onClick={() => setState('idle')}
          className={`inline-flex items-center ${sizeClasses} font-medium rounded-lg
            bg-slate-800 text-white hover:bg-slate-700 transition-colors`}
        >
          <Shield className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          Retry
        </button>
      </div>
    );
  }

  // ── Done State — show verification link ──
  return (
    <div className={`space-y-3 ${className}`}>
      {/* Success indicator */}
      <div className="flex items-center gap-2 text-emerald-600">
        <Check className="w-4 h-4" />
        <span className="text-sm font-medium">Sealed bundle created and downloaded</span>
      </div>

      {/* Verification URL */}
      {verifyUrl && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Verification Link (share with third parties)
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-slate-700 font-mono truncate">{verifyUrl}</code>
            <button
              type="button"
              onClick={handleCopyUrl}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium
                rounded bg-white border border-slate-200 text-slate-600
                hover:bg-slate-50 transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a
              href={verifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium
                rounded bg-white border border-slate-200 text-slate-600
                hover:bg-slate-50 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Open
            </a>
          </div>
        </div>
      )}

      {/* SHA-256 */}
      {sha256 && (
        <div className="text-xs text-slate-400">
          <span className="font-medium">SHA-256:</span>{' '}
          <code className="font-mono">{sha256.slice(0, 16)}…{sha256.slice(-16)}</code>
        </div>
      )}

      {/* Reset */}
      <button
        type="button"
        onClick={() => {
          setState('idle');
          setBundleId(null);
          setSha256(null);
        }}
        className="text-xs text-slate-500 hover:text-slate-700 underline"
      >
        Create another
      </button>
    </div>
  );
}
