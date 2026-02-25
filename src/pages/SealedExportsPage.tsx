/**
 * InspectVoice — Sealed Exports List Page
 * /sealed-exports — authenticated, shows all sealed bundles for the org.
 *
 * Features:
 *   - List all sealed exports with type, date, file count
 *   - Download .zip bundles
 *   - Copy verification URL for sharing
 *   - Filter by export type
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Download, Copy, Check, ExternalLink,
  FileSpreadsheet, FileText, Briefcase, Loader2,
  AlertTriangle, RefreshCw,
} from 'lucide-react';
import { getAuthToken } from '../utils/authToken';

// =============================================
// TYPES
// =============================================

interface SealedExport {
  readonly id: string;
  readonly bundle_id: string;
  readonly org_id: string;
  readonly export_type: string;
  readonly source_id: string | null;
  readonly generated_at: string;
  readonly generated_by: string;
  readonly generated_by_name: string;
  readonly file_count: number;
  readonly total_size_bytes: number;
  readonly manifest_sha256: string;
  readonly signing_key_id: string;
  readonly r2_key: string;
  readonly created_at: string;
}

type ExportTypeFilter = 'all' | 'defect_export' | 'pdf_report' | 'claims_pack';

// =============================================
// CONSTANTS
// =============================================

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;
const APP_URL = import.meta.env.VITE_APP_URL as string | undefined;

const TYPE_META: Record<string, { label: string; icon: typeof Shield; colour: string }> = {
  defect_export: { label: 'Defect Export', icon: FileSpreadsheet, colour: 'text-blue-600 bg-blue-50' },
  pdf_report: { label: 'PDF Report', icon: FileText, colour: 'text-emerald-600 bg-emerald-50' },
  claims_pack: { label: 'Claims Pack', icon: Briefcase, colour: 'text-amber-600 bg-amber-50' },
};

const FILTERS: Array<{ value: ExportTypeFilter; label: string }> = [
  { value: 'all', label: 'All Types' },
  { value: 'defect_export', label: 'Defect Exports' },
  { value: 'pdf_report', label: 'PDF Reports' },
  { value: 'claims_pack', label: 'Claims Packs' },
];

// =============================================
// COMPONENT
// =============================================

export default function SealedExportsPage() {
  const [exports, setExports] = useState<SealedExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ExportTypeFilter>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchExports = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Not authenticated');

      const params = filter !== 'all' ? `?export_type=${filter}` : '';
      const response = await fetch(`${API_BASE}/api/v1/sealed-exports${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) throw new Error(`Failed to load exports (${response.status})`);

      const body = (await response.json()) as { success: boolean; data: SealedExport[] };
      if (!body.success) throw new Error('Failed to load exports');

      setExports(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exports');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchExports();
  }, [fetchExports]);

  const handleDownload = useCallback(async (bundleId: string) => {
    setDownloadingId(bundleId);

    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(
        `${API_BASE}/api/v1/sealed-exports/${bundleId}/download`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        },
      );

      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `InspectVoice_Bundle_${bundleId}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const handleCopyVerifyUrl = useCallback(async (bundleId: string) => {
    const verifyUrl = `${APP_URL ?? window.location.origin}/verify/${bundleId}`;
    await navigator.clipboard.writeText(verifyUrl);
    setCopiedId(bundleId);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-slate-700" />
            Sealed Exports
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Tamper-evident document bundles with SHA-256 verification
          </p>
        </div>
        <button
          type="button"
          onClick={fetchExports}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg
            bg-white border border-slate-200 text-slate-600 hover:bg-slate-50
            disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              filter === f.value
                ? 'bg-slate-800 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && !error && exports.length === 0 && (
        <div className="text-center py-12 text-sm text-slate-400">
          <Shield className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p>No sealed exports yet</p>
          <p className="mt-1">Create a sealed export from the Defects, Inspections, or Incidents pages.</p>
        </div>
      )}

      {/* List */}
      {!loading && exports.length > 0 && (
        <div className="space-y-3">
          {exports.map((exp) => {
            const meta = TYPE_META[exp.export_type] ?? {
              label: exp.export_type,
              icon: Shield,
              colour: 'text-slate-600 bg-slate-50',
            };
            const TypeIcon = meta.icon;
            const generatedDate = new Date(exp.generated_at);
            const isDownloading = downloadingId === exp.bundle_id;
            const isCopied = copiedId === exp.bundle_id;

            return (
              <div
                key={exp.bundle_id}
                className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4"
              >
                {/* Icon */}
                <div className={`rounded-lg p-2.5 ${meta.colour}`}>
                  <TypeIcon className="w-5 h-5" />
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{meta.label}</span>
                    <span className="text-xs text-slate-400">
                      {exp.file_count} file{exp.file_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {generatedDate.toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}{' '}
                    at{' '}
                    {generatedDate.toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {exp.generated_by_name ? ` by ${exp.generated_by_name}` : ''}
                  </p>
                  <p className="text-xs text-slate-400 font-mono mt-1 truncate">
                    SHA-256: {exp.manifest_sha256.slice(0, 24)}…
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyVerifyUrl(exp.bundle_id)}
                    title="Copy verification link"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium
                      rounded-lg bg-white border border-slate-200 text-slate-600
                      hover:bg-slate-50 transition-colors"
                  >
                    {isCopied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {isCopied ? 'Copied' : 'Verify Link'}
                  </button>

                  <a
                    href={`${APP_URL ?? window.location.origin}/verify/${exp.bundle_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open verification page"
                    className="inline-flex items-center p-1.5 rounded-lg
                      bg-white border border-slate-200 text-slate-400
                      hover:text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <button
                    type="button"
                    onClick={() => handleDownload(exp.bundle_id)}
                    disabled={isDownloading}
                    title="Download sealed bundle"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium
                      rounded-lg bg-slate-800 text-white hover:bg-slate-700
                      disabled:opacity-50 disabled:cursor-wait transition-colors"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    Download
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
