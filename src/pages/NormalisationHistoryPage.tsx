/**
 * InspectVoice — Normalisation History Page
 * Manager/Admin view of all AI normalisation activity.
 *
 * Route: /normalisation-history
 *
 * Features:
 * - Token usage stats (current month + trend)
 * - Log table: field, original, normalised, status, reviewer, date
 * - Filter by status, field type, inspector
 * - Paginated results (server-side)
 * - Budget progress bar
 * - Responsive: cards on mobile, table on desktop
 *
 * API:
 *   GET /api/v1/normalise/history  → paginated log
 *   GET /api/v1/normalise/usage    → token usage stats
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Sparkles,
  Filter,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Inbox,
  RefreshCw,
  X,
  Check,
  XCircle,
  Clock,
  Cpu,
  Coins,
  BarChart3,
  AlertTriangle,
} from 'lucide-react';
import { useFetch } from '@hooks/useFetch';
import type {
  NormalisationLogEntry,
  NormalisationUsageResponse,
  NormalisableField,
} from '@/types/normalisation';
import { NORMALISABLE_FIELD_LABELS } from '@/types/normalisation';

// =============================================
// TYPES
// =============================================

interface LogListResponse {
  data: NormalisationLogEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

interface UsageApiResponse {
  data: NormalisationUsageResponse;
}

type StatusFilter = '' | 'pending' | 'accepted' | 'rejected';
type FieldFilter = '' | NormalisableField;

// =============================================
// CONSTANTS
// =============================================

const PAGE_SIZE = 20;

interface StatusStyleDef {
  bg: string;
  text: string;
  icon: typeof Check;
}

const STATUS_STYLES: Record<string, StatusStyleDef> = {
  accepted: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', icon: Check },
  rejected: { bg: 'bg-red-500/15', text: 'text-red-400', icon: XCircle },
  pending: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', icon: Clock },
};

const DEFAULT_STATUS_STYLE: StatusStyleDef = STATUS_STYLES['pending'];

/** Safely retrieve a status style with guaranteed non-undefined result. */
function getStatusStyle(status: string): StatusStyleDef {
  return STATUS_STYLES[status] ?? DEFAULT_STATUS_STYLE;
}

// =============================================
// HELPERS
// =============================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k`;
  return String(count);
}

// =============================================
// USAGE STATS CARDS
// =============================================

function UsageStats({ usage }: { usage: NormalisationUsageResponse | null }): JSX.Element | null {
  if (!usage) return null;

  const percentage = usage.budget_percentage_used;
  const barColour = percentage > 90 ? 'bg-red-400' : percentage > 70 ? 'bg-yellow-400' : 'bg-emerald-400';
  const currentHistory = usage.history[0];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {/* Budget usage */}
      <div className="sm:col-span-2 bg-iv-surface border border-iv-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-iv-accent" />
            <span className="text-xs font-medium text-iv-text">Token Budget</span>
          </div>
          <span className="text-xs text-iv-muted">{usage.current_month}</span>
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-xl font-bold text-iv-text">{formatTokens(usage.current_tokens_used)}</span>
          <span className="text-xs text-iv-muted">/ {formatTokens(usage.monthly_budget)}</span>
        </div>
        <div className="w-full h-2 bg-iv-surface-2 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColour}`} style={{ width: `${Math.min(100, percentage)}%` }} />
        </div>
        <p className="text-2xs text-iv-muted mt-1">{percentage}% used — {formatTokens(usage.budget_remaining)} remaining</p>
      </div>

      {/* Requests this month */}
      <div className="bg-iv-surface border border-iv-border rounded-xl p-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-iv-muted" />
          <span className="text-2xs text-iv-muted">Requests</span>
        </div>
        <p className="text-xl font-bold text-iv-text">
          {currentHistory?.request_count ?? 0}
        </p>
        <p className="text-2xs text-iv-muted mt-0.5">this month</p>
      </div>

      {/* Estimated cost */}
      <div className="bg-iv-surface border border-iv-border rounded-xl p-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Coins className="w-3.5 h-3.5 text-iv-muted" />
          <span className="text-2xs text-iv-muted">Est. Cost</span>
        </div>
        <p className="text-xl font-bold text-iv-text">
          ${currentHistory?.estimated_cost_usd ?? '0.00'}
        </p>
        <p className="text-2xs text-iv-muted mt-0.5">this month</p>
      </div>
    </div>
  );
}

// =============================================
// LOG ENTRY CARD (mobile)
// =============================================

function LogEntryCard({ entry }: { entry: NormalisationLogEntry }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const statusStyle = getStatusStyle(entry.status);
  const Icon = statusStyle.icon;

  return (
    <div className="bg-iv-surface border border-iv-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="text-xs font-medium text-iv-text">
            {NORMALISABLE_FIELD_LABELS[entry.field_name]}
          </span>
          <p className="text-2xs text-iv-muted mt-0.5">{formatDate(entry.created_at)}</p>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
          <Icon className="w-3 h-3" />
          {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
        </span>
      </div>

      {entry.diff_summary && (
        <p className="text-xs text-iv-muted mb-2">{entry.diff_summary}</p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="text-2xs text-iv-accent hover:underline"
      >
        {expanded ? 'Hide diff' : 'Show diff'}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          <div>
            <p className="text-2xs text-iv-muted mb-0.5">Original</p>
            <div className="text-xs text-iv-muted bg-red-500/5 border border-red-500/10 rounded-lg p-2 whitespace-pre-wrap max-h-24 overflow-y-auto">
              {entry.original_text}
            </div>
          </div>
          <div>
            <p className="text-2xs text-iv-accent mb-0.5">Normalised</p>
            <div className="text-xs text-iv-text bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2 whitespace-pre-wrap max-h-24 overflow-y-auto">
              {entry.normalised_text}
            </div>
          </div>
          {entry.rejected_reason && (
            <p className="text-2xs text-red-400">Reason: {entry.rejected_reason}</p>
          )}
          <p className="text-2xs text-iv-muted">
            Model: {entry.model_used} · {entry.input_tokens + entry.output_tokens} tokens
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================
// MAIN PAGE
// =============================================

export function NormalisationHistoryPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (searchParams.get('status') as StatusFilter) ?? '',
  );
  const [fieldFilter, setFieldFilter] = useState<FieldFilter>(
    (searchParams.get('field_name') as FieldFilter) ?? '',
  );
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1));

  // ── Build API URL ──────────────────────────
  const logUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    params.set('sort', 'created_at');
    params.set('order', 'desc');
    if (statusFilter) params.set('status', statusFilter);
    if (fieldFilter) params.set('field_name', fieldFilter);
    return `/api/v1/normalise/history?${params.toString()}`;
  }, [page, statusFilter, fieldFilter]);

  // ── Fetch ──────────────────────────────────
  const { data: logData, loading: logLoading, error: logError, refetch: refetchLog } =
    useFetch<LogListResponse>(logUrl);

  const { data: usageData } =
    useFetch<UsageApiResponse>('/api/v1/normalise/usage');

  const entries = logData?.data ?? [];
  const meta = logData?.meta ?? { total: 0, page: 1, limit: PAGE_SIZE, total_pages: 0 };
  const usage = usageData?.data ?? null;

  const hasActiveFilters = Boolean(statusFilter || fieldFilter);

  // ── Sync URL ───────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page));
    if (statusFilter) params.set('status', statusFilter);
    if (fieldFilter) params.set('field_name', fieldFilter);
    setSearchParams(params, { replace: true });
  }, [page, statusFilter, fieldFilter, setSearchParams]);

  const handleClearFilters = useCallback(() => {
    setStatusFilter('');
    setFieldFilter('');
    setPage(1);
  }, []);

  return (
    <>
      <Helmet>
        <title>Normalisation History — InspectVoice</title>
      </Helmet>

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-iv-accent/15 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-iv-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-iv-text">Normalisation History</h1>
              <p className="text-xs text-iv-muted mt-0.5">
                AI style normalisation log and token usage
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={refetchLog}
            disabled={logLoading}
            className="iv-btn-icon"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${logLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Usage stats */}
        <UsageStats usage={usage} />

        {/* Filters */}
        <div className="bg-iv-surface border border-iv-border rounded-xl p-3 flex flex-wrap items-center gap-3">
          <Filter className="w-4 h-4 text-iv-muted shrink-0" />

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}
            className="px-3 py-1.5 bg-iv-surface-2 border border-iv-border rounded-lg text-xs text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>

          <select
            value={fieldFilter}
            onChange={(e) => { setFieldFilter(e.target.value as FieldFilter); setPage(1); }}
            className="px-3 py-1.5 bg-iv-surface-2 border border-iv-border rounded-lg text-xs text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40"
          >
            <option value="">All fields</option>
            {Object.entries(NORMALISABLE_FIELD_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1 text-2xs text-iv-muted hover:text-iv-text transition-colors"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}

          <span className="ml-auto text-2xs text-iv-muted">
            {meta.total} entr{meta.total !== 1 ? 'ies' : 'y'}
          </span>
        </div>

        {/* Loading */}
        {logLoading && !logData && (
          <div className="flex flex-col items-center justify-center py-16 text-iv-muted">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">Loading history…</p>
          </div>
        )}

        {/* Error */}
        {logError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-red-400 mb-1">Failed to load history</p>
            <p className="text-xs text-iv-muted mb-4">{logError.message}</p>
            <button type="button" onClick={refetchLog} className="iv-btn-secondary inline-flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {!logLoading && !logError && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-iv-muted">
            <Inbox className="w-10 h-10 mb-3 text-iv-muted-2" />
            <p className="text-sm font-medium text-iv-text mb-1">
              {hasActiveFilters ? 'No entries match your filters' : 'No normalisation history yet'}
            </p>
            <p className="text-xs text-iv-muted">
              {hasActiveFilters
                ? 'Try adjusting your filters.'
                : 'History will appear here once inspectors use AI normalisation.'}
            </p>
          </div>
        )}

        {/* Results — mobile cards */}
        {entries.length > 0 && (
          <>
            <div className="lg:hidden space-y-3">
              {entries.map((entry) => (
                <LogEntryCard key={entry.id} entry={entry} />
              ))}
            </div>

            {/* Results — desktop table */}
            <div className="hidden lg:block bg-iv-surface border border-iv-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-iv-border bg-iv-surface-2/50">
                      <th className="py-2.5 px-4 text-left text-2xs font-medium text-iv-muted">Field</th>
                      <th className="py-2.5 px-4 text-left text-2xs font-medium text-iv-muted">Change Summary</th>
                      <th className="py-2.5 px-4 text-left text-2xs font-medium text-iv-muted">Status</th>
                      <th className="py-2.5 px-4 text-left text-2xs font-medium text-iv-muted">Model</th>
                      <th className="py-2.5 px-4 text-left text-2xs font-medium text-iv-muted">Tokens</th>
                      <th className="py-2.5 px-4 text-left text-2xs font-medium text-iv-muted">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const style = getStatusStyle(entry.status);
                      const Icon = style.icon;
                      return (
                        <tr key={entry.id} className="border-b last:border-b-0 border-iv-border hover:bg-iv-surface-2/50 transition-colors">
                          <td className="py-2.5 px-4">
                            <span className="text-xs text-iv-text">{NORMALISABLE_FIELD_LABELS[entry.field_name]}</span>
                          </td>
                          <td className="py-2.5 px-4 max-w-xs">
                            <p className="text-xs text-iv-muted line-clamp-1">{entry.diff_summary ?? '—'}</p>
                          </td>
                          <td className="py-2.5 px-4">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium ${style.bg} ${style.text}`}>
                              <Icon className="w-3 h-3" />
                              {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                            </span>
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="text-2xs text-iv-muted font-mono">
                              {entry.model_used.includes('haiku') ? 'Haiku' : 'Sonnet'}
                            </span>
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="text-2xs text-iv-muted">
                              {formatTokens(entry.input_tokens + entry.output_tokens)}
                            </span>
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="text-2xs text-iv-muted whitespace-nowrap">
                              {formatDate(entry.created_at)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {meta.total_pages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-iv-muted">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, meta.total)} of {meta.total}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { setPage((p) => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    disabled={page <= 1}
                    className="iv-btn-icon disabled:opacity-30"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-3 py-1 text-xs font-medium text-iv-text">{page} / {meta.total_pages}</span>
                  <button
                    type="button"
                    onClick={() => { setPage((p) => Math.min(meta.total_pages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    disabled={page >= meta.total_pages}
                    className="iv-btn-icon disabled:opacity-30"
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default NormalisationHistoryPage;
