/**
 * InspectVoice — Inspector Performance Overview (Manager/Admin)
 * Feature 14: Org-wide performance table with filters
 *
 * Route: /inspector-performance
 * RBAC: org:admin + org:manager only
 *
 * Shows:
 *   - Period filter bar (Last 7 Days, Month, Quarter, YTD, Rolling 90, Custom)
 *   - Optional inspection type filter
 *   - Sortable table: inspector name, inspections completed, completeness,
 *     overdue rate, avg sign-off time, photo compliance, evidence quality,
 *     make-safe, rework rate, audit flags
 *   - Row click → drill-in to /inspector-performance/:userId
 *   - "Share Your Month" action per inspector
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Users,
  ChevronUp,
  ChevronDown,
  Filter,
  Share2,
  ArrowUpDown,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { INSPECTION_TYPE_LABELS } from '@/types';
import type { PeriodPreset } from '@/types/features14_15';
import { PERIOD_PRESET_LABELS } from '@/types/features14_15';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// =============================================
// TYPES
// =============================================

interface InspectorRow {
  inspector_user_id: string;
  inspector_name: string;
  inspector_email: string;
  inspections_completed: number;
  completeness_avg: number | null;
  overdue_rate: number | null;
  avg_time_to_signoff_seconds: number | null;
  photo_compliance_pct: number | null;
  evidence_quality_pct: number | null;
  makesafe_initiated_count: number;
  makesafe_completed_count: number;
  rework_rate: number | null;
  audit_flag_count: number;
}

interface OverviewResponse {
  period: { start: string; end: string; preset: string };
  inspectors: InspectorRow[];
}

type SortKey = keyof InspectorRow;
type SortDir = 'asc' | 'desc';

// =============================================
// HELPERS
// =============================================

function formatMinutes(seconds: number | null): string {
  if (seconds === null) return '—';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(1)}%`;
}

function pctColour(value: number | null, goodAbove = 80, warnAbove = 50): string {
  if (value === null) return 'iv-muted';
  if (value >= goodAbove) return 'text-[#22C55E]';
  if (value >= warnAbove) return 'text-[#EAB308]';
  return 'text-[#F97316]';
}

function pctColourInverse(value: number | null, goodBelow = 10, warnBelow = 25): string {
  if (value === null) return 'iv-muted';
  if (value <= goodBelow) return 'text-[#22C55E]';
  if (value <= warnBelow) return 'text-[#EAB308]';
  return 'text-[#F97316]';
}

// =============================================
// COMPONENT
// =============================================

export default function InspectorPerformancePage(): JSX.Element {
  const navigate = useNavigate();
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewResponse | null>(null);

  // Filters
  const [period, setPeriod] = useState<PeriodPreset>('month');
  const [inspectionType, setInspectionType] = useState<string>('');

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('inspections_completed');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Share modal
  const [sharingUserId, setSharingUserId] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // ── Fetch ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ period });
      if (inspectionType) params.set('inspection_type', inspectionType);

      const res = await fetch(`${API_BASE}/api/v1/inspector-performance?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const json = await res.json() as { data: OverviewResponse };
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  }, [getToken, period, inspectionType]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ── Sort ──
  const handleSort = useCallback((key: SortKey) => {
    setSortDir((prev) => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortKey(key);
  }, [sortKey]);

  const sortedInspectors = useMemo(() => {
    if (!data?.inspectors) return [];
    return [...data.inspectors].sort((a, b) => {
      const aVal = a[sortKey] ?? -Infinity;
      const bVal = b[sortKey] ?? -Infinity;
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  // ── Share handler ──
  const handleShare = useCallback(async (userId: string) => {
    if (!data) return;
    setSharingUserId(userId);
    setShareLoading(true);
    setShareUrl(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/v1/inspector-performance/${userId}/share`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_start: data.period.start,
          period_end: data.period.end,
        }),
      });
      if (!res.ok) throw new Error('Failed to create share link');
      const json = await res.json() as { data: { url: string } };
      setShareUrl(`${window.location.origin}${json.data.url}`);
    } catch {
      setShareUrl(null);
    } finally {
      setShareLoading(false);
    }
  }, [getToken, data]);

  // ── Sort header helper ──
  function SortHeader({ label, field }: { label: string; field: SortKey }): JSX.Element {
    const isActive = sortKey === field;
    return (
      <button
        type="button"
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 text-xs font-medium iv-muted hover:text-iv-text transition-colors"
      >
        {label}
        {isActive ? (
          sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" />
        )}
      </button>
    );
  }

  // ── Loading / Error ──
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Helmet><title>Performance Overview | InspectVoice</title></Helmet>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 iv-muted animate-spin" />
          <p className="iv-muted text-sm">Loading performance data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <Helmet><title>Error | InspectVoice</title></Helmet>
        <div className="iv-panel p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold iv-text mb-2">Failed to Load</h2>
          <p className="iv-muted text-sm mb-4">{error}</p>
          <button type="button" onClick={fetchData} className="iv-btn-primary">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <Helmet>
        <title>Inspector Performance | InspectVoice</title>
        <meta name="description" content="Organisation-wide inspector performance and quality insights." />
      </Helmet>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="iv-btn-icon" aria-label="Back to dashboard">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold iv-text flex items-center gap-2">
              <Users className="w-5 h-5 text-iv-accent" />
              Inspector Performance
            </h1>
            {data?.period && (
              <p className="text-sm iv-muted">
                {data.period.start} — {data.period.end}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="iv-panel p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 iv-muted" />
            <span className="text-sm font-medium iv-text">Period:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(PERIOD_PRESET_LABELS) as Array<[PeriodPreset, string]>)
              .filter(([key]) => key !== 'custom')
              .map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPeriod(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    period === key
                      ? 'bg-iv-accent/15 text-iv-accent border border-iv-accent/30'
                      : 'bg-iv-surface-2 iv-muted border border-transparent hover:border-iv-border'
                  }`}
                >
                  {label}
                </button>
              ))}
          </div>

          <div className="h-6 w-px bg-iv-border hidden sm:block" />

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium iv-text">Type:</span>
            <select
              value={inspectionType}
              onChange={(e) => setInspectionType(e.target.value)}
              className="iv-input text-xs py-1.5 pr-8"
            >
              <option value="">All Types</option>
              {Object.entries(INSPECTION_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {data?.inspectors && data.inspectors.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="iv-panel p-4 text-center">
            <p className="text-2xl font-bold iv-text">{data.inspectors.length}</p>
            <p className="text-xs iv-muted">Active Inspectors</p>
          </div>
          <div className="iv-panel p-4 text-center">
            <p className="text-2xl font-bold iv-text">
              {data.inspectors.reduce((s, i) => s + i.inspections_completed, 0)}
            </p>
            <p className="text-xs iv-muted">Total Inspections</p>
          </div>
          <div className="iv-panel p-4 text-center">
            <p className={`text-2xl font-bold ${pctColour(
              data.inspectors.length > 0
                ? data.inspectors.reduce((s, i) => s + (i.photo_compliance_pct ?? 0), 0) / data.inspectors.length
                : null
            )}`}>
              {data.inspectors.length > 0
                ? formatPct(data.inspectors.reduce((s, i) => s + (i.photo_compliance_pct ?? 0), 0) / data.inspectors.length)
                : '—'}
            </p>
            <p className="text-xs iv-muted">Avg Photo Compliance</p>
          </div>
          <div className="iv-panel p-4 text-center">
            <p className={`text-2xl font-bold ${pctColourInverse(
              data.inspectors.length > 0
                ? data.inspectors.reduce((s, i) => s + (i.overdue_rate ?? 0), 0) / data.inspectors.length
                : null
            )}`}>
              {data.inspectors.length > 0
                ? formatPct(data.inspectors.reduce((s, i) => s + (i.overdue_rate ?? 0), 0) / data.inspectors.length)
                : '—'}
            </p>
            <p className="text-xs iv-muted">Avg Overdue Rate</p>
          </div>
        </div>
      )}

      {/* Table */}
      {sortedInspectors.length === 0 ? (
        <div className="iv-panel p-8 text-center">
          <Users className="w-12 h-12 iv-muted mx-auto mb-3 opacity-50" />
          <p className="iv-muted text-sm">No performance data for this period.</p>
        </div>
      ) : (
        <div className="iv-panel overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-iv-border">
                <th className="text-left px-4 py-3"><SortHeader label="Inspector" field="inspector_name" /></th>
                <th className="text-right px-3 py-3"><SortHeader label="Inspections" field="inspections_completed" /></th>
                <th className="text-right px-3 py-3"><SortHeader label="Completeness" field="completeness_avg" /></th>
                <th className="text-right px-3 py-3"><SortHeader label="Overdue" field="overdue_rate" /></th>
                <th className="text-right px-3 py-3"><SortHeader label="Avg Sign-off" field="avg_time_to_signoff_seconds" /></th>
                <th className="text-right px-3 py-3"><SortHeader label="Photo %" field="photo_compliance_pct" /></th>
                <th className="text-right px-3 py-3"><SortHeader label="Evidence" field="evidence_quality_pct" /></th>
                <th className="text-right px-3 py-3"><SortHeader label="Make-Safe" field="makesafe_initiated_count" /></th>
                <th className="text-right px-3 py-3"><SortHeader label="Rework" field="rework_rate" /></th>
                <th className="text-right px-3 py-3"><SortHeader label="Flags" field="audit_flag_count" /></th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {sortedInspectors.map((inspector) => (
                <tr
                  key={inspector.inspector_user_id}
                  className="border-b border-iv-border/50 hover:bg-iv-surface-2/50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/inspector-performance/${inspector.inspector_user_id}`)}
                >
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium iv-text">{inspector.inspector_name}</p>
                    <p className="text-xs iv-muted truncate max-w-[200px]">{inspector.inspector_email}</p>
                  </td>
                  <td className="text-right px-3 py-3 text-sm iv-text font-medium">
                    {inspector.inspections_completed}
                  </td>
                  <td className={`text-right px-3 py-3 text-sm font-medium ${pctColour(inspector.completeness_avg)}`}>
                    {formatPct(inspector.completeness_avg)}
                  </td>
                  <td className={`text-right px-3 py-3 text-sm font-medium ${pctColourInverse(inspector.overdue_rate)}`}>
                    {formatPct(inspector.overdue_rate)}
                  </td>
                  <td className="text-right px-3 py-3 text-sm iv-muted">
                    {formatMinutes(inspector.avg_time_to_signoff_seconds)}
                  </td>
                  <td className={`text-right px-3 py-3 text-sm font-medium ${pctColour(inspector.photo_compliance_pct)}`}>
                    {formatPct(inspector.photo_compliance_pct)}
                  </td>
                  <td className={`text-right px-3 py-3 text-sm font-medium ${pctColour(inspector.evidence_quality_pct)}`}>
                    {formatPct(inspector.evidence_quality_pct)}
                  </td>
                  <td className="text-right px-3 py-3 text-sm iv-text">
                    {inspector.makesafe_initiated_count}/{inspector.makesafe_completed_count}
                  </td>
                  <td className={`text-right px-3 py-3 text-sm font-medium ${pctColourInverse(inspector.rework_rate)}`}>
                    {formatPct(inspector.rework_rate)}
                  </td>
                  <td className="text-right px-3 py-3 text-sm">
                    {inspector.audit_flag_count > 0 ? (
                      <span className="text-[#F97316] font-medium">{inspector.audit_flag_count}</span>
                    ) : (
                      <span className="iv-muted">0</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleShare(inspector.inspector_user_id);
                      }}
                      className="iv-btn-icon opacity-60 hover:opacity-100"
                      title="Share Your Month summary"
                      aria-label={`Share summary for ${inspector.inspector_name}`}
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Share modal */}
      {sharingUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="iv-panel p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold iv-text mb-3 flex items-center gap-2">
              <Share2 className="w-5 h-5 text-iv-accent" />
              Share Performance Summary
            </h3>
            {shareLoading ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="w-4 h-4 animate-spin iv-muted" />
                <span className="text-sm iv-muted">Generating link...</span>
              </div>
            ) : shareUrl ? (
              <div>
                <p className="text-sm iv-muted mb-3">
                  Copy this link to share with the inspector. It shows only their data and expires in 30 days.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="iv-input flex-1 text-xs"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    type="button"
                    onClick={() => { void navigator.clipboard.writeText(shareUrl); }}
                    className="iv-btn-primary text-xs px-3"
                  >
                    Copy
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-red-400">Failed to generate link. Try again.</p>
            )}
            <button
              type="button"
              onClick={() => { setSharingUserId(null); setShareUrl(null); }}
              className="iv-btn-secondary w-full mt-4"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
