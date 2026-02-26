/**
 * InspectVoice — Defect Tracker Page
 * All defects across all sites with filtering, sorting, pagination, and assignment tracking.
 *
 * Route: /defects
 * Replaces placeholder in App.tsx
 *
 * Features:
 * - Filter by status, severity, action timeframe, site, assignment
 * - Search by description or BS EN reference
 * - Sort by due date, severity, status, created date
 * - Paginated results (server-side)
 * - Severity and status badges with colour coding
 * - Overdue/due-soon visual warnings
 * - Cost band display (estimated vs actual)
 * - Excel/CSV defect export with citywide summary
 * - One-tap Make Safe / Close Asset with photo + recommendation
 * - Responsive: cards on mobile, table on desktop
 * - Loading, error, and empty states
 *
 * API: GET /api/defects?page=1&limit=20&status=...&severity=...&search=...&sort=...&order=...
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  AlertTriangle,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  X,
  Loader2,
  Inbox,
  RefreshCw,
  MapPin,
  Clock,
  User,
  Calendar,
  PoundSterling,
  AlertCircle,
  CheckCircle,
  PauseCircle,
  CircleDot,
} from 'lucide-react';
import { useFetch } from '@hooks/useFetch';
import { DefectExportButton } from '@components/DefectExportButton';
import { MakeSafeButton } from '@components/MakeSafeModal';
import type { Defect } from '@/types/entities';
import {
  DefectStatus,
  RiskRating,
  ActionTimeframe,
  DEFECT_STATUS_LABELS,
  RISK_RATING_LABELS,
  ACTION_TIMEFRAME_LABELS,
} from '@/types/enums';

// =============================================
// TYPES
// =============================================

/** Extended defect with joined display fields from API */
interface DefectListItem extends Defect {
  site_name: string;
  asset_code_display: string;
  assigned_to_name: string | null;
  inspection_date: string;
  made_safe?: boolean;
}

interface DefectListResponse {
  data: DefectListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
  summary: {
    total_open: number;
    total_overdue: number;
    very_high_count: number;
    high_count: number;
    medium_count: number;
    low_count: number;
  };
}

type SortField = 'due_date' | 'severity' | 'status' | 'created_at' | 'action_timeframe';
type SortOrder = 'asc' | 'desc';

// =============================================
// CONSTANTS
// =============================================

const PAGE_SIZE = 20;

const STATUS_STYLES: Record<DefectStatus, { bg: string; text: string; icon: typeof AlertCircle }> = {
  [DefectStatus.OPEN]: { bg: 'bg-red-500/15', text: 'text-red-400', icon: AlertCircle },
  [DefectStatus.ASSIGNED]: { bg: 'bg-orange-500/15', text: 'text-orange-400', icon: CircleDot },
  [DefectStatus.IN_PROGRESS]: { bg: 'bg-iv-accent/15', text: 'text-iv-accent', icon: Clock },
  [DefectStatus.RESOLVED]: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', icon: CheckCircle },
  [DefectStatus.VERIFIED]: { bg: 'bg-emerald-600/15', text: 'text-emerald-300', icon: CheckCircle },
  [DefectStatus.DEFERRED]: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', icon: PauseCircle },
  [DefectStatus.NOT_ACTIONED]: { bg: 'bg-iv-muted/15', text: 'text-iv-muted', icon: PauseCircle },
};

const SEVERITY_STYLES: Record<RiskRating, { bg: string; text: string; dot: string }> = {
  [RiskRating.VERY_HIGH]: { bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-400' },
  [RiskRating.HIGH]: { bg: 'bg-orange-500/15', text: 'text-orange-400', dot: 'bg-orange-400' },
  [RiskRating.MEDIUM]: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  [RiskRating.LOW]: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
};

// =============================================
// HELPER FUNCTIONS
// =============================================

/** Calculate days until due or days overdue */
function getDueDateInfo(dueDate: string | null): { label: string; isOverdue: boolean; isDueSoon: boolean } | null {
  if (!dueDate) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return {
      label: `${absDays} day${absDays !== 1 ? 's' : ''} overdue`,
      isOverdue: true,
      isDueSoon: false,
    };
  }

  if (diffDays === 0) {
    return { label: 'Due today', isOverdue: false, isDueSoon: true };
  }

  if (diffDays <= 7) {
    return {
      label: `Due in ${diffDays} day${diffDays !== 1 ? 's' : ''}`,
      isOverdue: false,
      isDueSoon: true,
    };
  }

  return {
    label: `Due in ${diffDays} days`,
    isOverdue: false,
    isDueSoon: false,
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatCost(estimated: number | null, actual: number | null): string {
  if (actual !== null) return `£${actual.toLocaleString('en-GB')}`;
  if (estimated !== null) return `~£${estimated.toLocaleString('en-GB')}`;
  return '—';
}

// =============================================
// HELPER COMPONENTS
// =============================================

function DefectStatusBadge({ status }: { status: DefectStatus }): JSX.Element {
  const style = STATUS_STYLES[status];
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      <Icon className="w-3 h-3" />
      {DEFECT_STATUS_LABELS[status]}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: RiskRating }): JSX.Element {
  const style = SEVERITY_STYLES[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {RISK_RATING_LABELS[severity]}
    </span>
  );
}

function DueDateIndicator({ dueDate, status }: { dueDate: string | null; status: DefectStatus }): JSX.Element {
  // Don't show due date warnings for resolved/verified defects
  const isTerminal = status === DefectStatus.RESOLVED || status === DefectStatus.VERIFIED;
  const info = getDueDateInfo(dueDate);

  if (!info) {
    return <span className="text-xs text-iv-muted-2">No due date</span>;
  }

  const colorClass = isTerminal
    ? 'text-iv-muted'
    : info.isOverdue
      ? 'text-red-400'
      : info.isDueSoon
        ? 'text-yellow-400'
        : 'text-iv-muted';

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${colorClass}`}>
      {!isTerminal && info.isOverdue && <AlertCircle className="w-3 h-3" />}
      {info.label}
    </span>
  );
}

function SortButton({
  field,
  label,
  currentSort,
  currentOrder,
  onSort,
}: {
  field: SortField;
  label: string;
  currentSort: SortField;
  currentOrder: SortOrder;
  onSort: (field: SortField) => void;
}): JSX.Element {
  const isActive = currentSort === field;

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${
        isActive ? 'text-iv-accent' : 'text-iv-muted hover:text-iv-text'
      }`}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {isActive ? (
        currentOrder === 'desc' ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronUp className="w-3 h-3" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-40" />
      )}
    </button>
  );
}

// =============================================
// SUMMARY CARDS
// =============================================

function SummaryCards({ summary }: { summary: DefectListResponse['summary'] | null }): JSX.Element | null {
  if (!summary) return null;

  const cards = [
    { label: 'Open', value: summary.total_open, color: 'text-red-400', bg: 'bg-red-500/10' },
    { label: 'Overdue', value: summary.total_overdue, color: 'text-orange-400', bg: 'bg-orange-500/10' },
    { label: 'Very High', value: summary.very_high_count, color: 'text-red-400', bg: 'bg-red-500/10' },
    { label: 'High', value: summary.high_count, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((card) => (
        <div key={card.label} className={`${card.bg} border border-iv-border rounded-xl p-3 text-center`}>
          <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
          <p className="text-2xs text-iv-muted mt-0.5">{card.label}</p>
        </div>
      ))}
    </div>
  );
}

// =============================================
// FILTER BAR
// =============================================

interface FilterState {
  search: string;
  status: DefectStatus | '';
  severity: RiskRating | '';
  timeframe: ActionTimeframe | '';
  overdue: '' | 'true';
}

const INITIAL_FILTERS: FilterState = {
  search: '',
  status: '',
  severity: '',
  timeframe: '',
  overdue: '',
};

function FilterBar({
  filters,
  onFilterChange,
  onClearFilters,
  hasActiveFilters,
}: {
  filters: FilterState;
  onFilterChange: (key: keyof FilterState, value: string) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-iv-surface border border-iv-border rounded-xl">
      {/* Search + toggle row */}
      <div className="p-3 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-iv-muted" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onFilterChange('search', e.target.value)}
            placeholder="Search by description or BS EN reference…"
            className="w-full pl-9 pr-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            aria-label="Search defects"
          />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className={`iv-btn-icon relative ${expanded ? 'text-iv-accent' : ''}`}
          aria-expanded={expanded}
          aria-controls="defect-filters"
          aria-label={expanded ? 'Hide filters' : 'Show filters'}
          title="Filters"
        >
          <Filter className="w-4 h-4" />
          {hasActiveFilters && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-iv-accent" />
          )}
        </button>
      </div>

      {/* Expandable filter panel */}
      {expanded && (
        <div
          id="defect-filters"
          className="px-3 pb-3 border-t border-iv-border pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
        >
          {/* Status filter */}
          <div>
            <label htmlFor="filter-defect-status" className="block text-2xs font-medium text-iv-muted mb-1">
              Status
            </label>
            <select
              id="filter-defect-status"
              value={filters.status}
              onChange={(e) => onFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            >
              <option value="">All statuses</option>
              {Object.values(DefectStatus).map((status) => (
                <option key={status} value={status}>
                  {DEFECT_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>

          {/* Severity filter */}
          <div>
            <label htmlFor="filter-severity" className="block text-2xs font-medium text-iv-muted mb-1">
              Severity
            </label>
            <select
              id="filter-severity"
              value={filters.severity}
              onChange={(e) => onFilterChange('severity', e.target.value)}
              className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            >
              <option value="">All severities</option>
              {Object.values(RiskRating).map((rating) => (
                <option key={rating} value={rating}>
                  {RISK_RATING_LABELS[rating]}
                </option>
              ))}
            </select>
          </div>

          {/* Timeframe filter */}
          <div>
            <label htmlFor="filter-timeframe" className="block text-2xs font-medium text-iv-muted mb-1">
              Action Timeframe
            </label>
            <select
              id="filter-timeframe"
              value={filters.timeframe}
              onChange={(e) => onFilterChange('timeframe', e.target.value)}
              className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            >
              <option value="">All timeframes</option>
              {Object.values(ActionTimeframe).map((tf) => (
                <option key={tf} value={tf}>
                  {ACTION_TIMEFRAME_LABELS[tf]}
                </option>
              ))}
            </select>
          </div>

          {/* Overdue only toggle */}
          <div>
            <label htmlFor="filter-overdue" className="block text-2xs font-medium text-iv-muted mb-1">
              Overdue Only
            </label>
            <select
              id="filter-overdue"
              value={filters.overdue}
              onChange={(e) => onFilterChange('overdue', e.target.value)}
              className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            >
              <option value="">All defects</option>
              <option value="true">Overdue only</option>
            </select>
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
              <button
                type="button"
                onClick={onClearFilters}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-iv-muted hover:text-iv-text transition-colors"
              >
                <X className="w-3 h-3" />
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================
// PAGINATION
// =============================================

function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}): JSX.Element | null {
  if (totalPages <= 1) return null;

  const startItem = (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex items-center justify-between pt-4 border-t border-iv-border">
      <p className="text-xs text-iv-muted">
        {startItem}–{endItem} of {total} defects
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="iv-btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-3 py-1 text-xs font-medium text-iv-text">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="iv-btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// =============================================
// DEFECT CARD (Mobile)
// =============================================

function DefectCard({ defect, onRefresh }: { defect: DefectListItem; onRefresh: () => void }): JSX.Element {
  const dueDateInfo = getDueDateInfo(defect.due_date);
  const isTerminal = defect.status === DefectStatus.RESOLVED || defect.status === DefectStatus.VERIFIED;

  return (
    <div
      className={`bg-iv-surface border rounded-xl p-4 transition-colors ${
        !isTerminal && dueDateInfo?.isOverdue
          ? 'border-red-500/30 hover:border-red-500/50'
          : 'border-iv-border hover:border-iv-accent/30'
      }`}
    >
      {/* Header: severity + status + make safe */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={defect.severity} />
          <DefectStatusBadge status={defect.status} />
        </div>
        {!isTerminal && (
          <MakeSafeButton
            defectId={defect.id}
            severity={defect.severity}
            description={defect.description}
            siteName={defect.site_name}
            assetCode={defect.asset_code_display}
            alreadyMadeSafe={defect.made_safe}
            onSuccess={onRefresh}
          />
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-iv-text line-clamp-2 mb-2">{defect.description}</p>

      {/* BS EN reference */}
      {defect.bs_en_reference && (
        <p className="text-2xs text-iv-muted font-mono mb-3">{defect.bs_en_reference}</p>
      )}

      {/* Detail rows */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3 h-3 text-iv-muted shrink-0" />
          <Link
            to={`/sites/${defect.site_id}`}
            className="text-xs text-iv-muted hover:text-iv-accent transition-colors line-clamp-1"
          >
            {defect.site_name}
          </Link>
          {defect.asset_code_display && (
            <span className="text-xs text-iv-muted-2">· {defect.asset_code_display}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-iv-muted shrink-0" />
          <span className="text-xs text-iv-muted">
            {ACTION_TIMEFRAME_LABELS[defect.action_timeframe]}
          </span>
        </div>

        {defect.assigned_to_name && (
          <div className="flex items-center gap-1.5">
            <User className="w-3 h-3 text-iv-muted shrink-0" />
            <span className="text-xs text-iv-muted">{defect.assigned_to_name}</span>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <Calendar className="w-3 h-3 text-iv-muted shrink-0" />
          <DueDateIndicator dueDate={defect.due_date} status={defect.status} />
        </div>
      </div>

      {/* Footer: cost + remedial action */}
      <div className="pt-3 border-t border-iv-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <PoundSterling className="w-3 h-3 text-iv-muted" />
            <span className="text-xs text-iv-muted">
              {formatCost(defect.estimated_cost_gbp, defect.actual_cost_gbp)}
            </span>
          </div>
          <span className="text-2xs text-iv-muted-2">
            Found {formatDate(defect.created_at)}
          </span>
        </div>

        {/* Remedial action preview */}
        <p className="text-xs text-iv-muted line-clamp-2">{defect.remedial_action}</p>
      </div>
    </div>
  );
}

// =============================================
// DEFECT TABLE ROW (Desktop)
// =============================================

function DefectRow({ defect, onRefresh }: { defect: DefectListItem; onRefresh: () => void }): JSX.Element {
  const dueDateInfo = getDueDateInfo(defect.due_date);
  const isTerminal = defect.status === DefectStatus.RESOLVED || defect.status === DefectStatus.VERIFIED;

  return (
    <tr
      className={`border-b last:border-b-0 transition-colors ${
        !isTerminal && dueDateInfo?.isOverdue
          ? 'border-red-500/20 bg-red-500/5 hover:bg-red-500/10'
          : 'border-iv-border hover:bg-iv-surface-2/50'
      }`}
    >
      {/* Severity */}
      <td className="py-3 px-4">
        <SeverityBadge severity={defect.severity} />
      </td>

      {/* Description */}
      <td className="py-3 px-4 max-w-xs">
        <p className="text-sm text-iv-text line-clamp-1" title={defect.description}>
          {defect.description}
        </p>
        {defect.bs_en_reference && (
          <p className="text-2xs text-iv-muted font-mono mt-0.5">{defect.bs_en_reference}</p>
        )}
      </td>

      {/* Site + Asset */}
      <td className="py-3 px-4">
        <Link
          to={`/sites/${defect.site_id}`}
          className="text-sm text-iv-text hover:text-iv-accent transition-colors line-clamp-1"
        >
          {defect.site_name}
        </Link>
        {defect.asset_code_display && (
          <p className="text-2xs text-iv-muted mt-0.5">{defect.asset_code_display}</p>
        )}
      </td>

      {/* Timeframe */}
      <td className="py-3 px-4">
        <span className="text-sm text-iv-muted whitespace-nowrap">
          {ACTION_TIMEFRAME_LABELS[defect.action_timeframe]}
        </span>
      </td>

      {/* Status */}
      <td className="py-3 px-4">
        <DefectStatusBadge status={defect.status} />
      </td>

      {/* Assigned */}
      <td className="py-3 px-4">
        <span className="text-sm text-iv-muted line-clamp-1">
          {defect.assigned_to_name ?? '—'}
        </span>
      </td>

      {/* Due date */}
      <td className="py-3 px-4">
        <div>
          <span className="text-sm text-iv-muted whitespace-nowrap">{formatDate(defect.due_date)}</span>
          <div className="mt-0.5">
            <DueDateIndicator dueDate={defect.due_date} status={defect.status} />
          </div>
        </div>
      </td>

      {/* Make Safe */}
      <td className="py-3 px-4">
        {!isTerminal ? (
          <MakeSafeButton
            defectId={defect.id}
            severity={defect.severity}
            description={defect.description}
            siteName={defect.site_name}
            assetCode={defect.asset_code_display}
            alreadyMadeSafe={defect.made_safe}
            onSuccess={onRefresh}
          />
        ) : (
          <span className="text-xs text-iv-muted-2">—</span>
        )}
      </td>
    </tr>
  );
}

// =============================================
// MAIN PAGE COMPONENT
// =============================================

export function DefectTracker(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── State ──────────────────────────────────
  const [filters, setFilters] = useState<FilterState>(() => ({
    search: searchParams.get('search') ?? '',
    status: (searchParams.get('status') as DefectStatus) ?? '',
    severity: (searchParams.get('severity') as RiskRating) ?? '',
    timeframe: (searchParams.get('timeframe') as ActionTimeframe) ?? '',
    overdue: (searchParams.get('overdue') as '' | 'true') ?? '',
  }));

  const [sortField, setSortField] = useState<SortField>(
    (searchParams.get('sort') as SortField) ?? 'severity',
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    (searchParams.get('order') as SortOrder) ?? 'desc',
  );
  const [page, setPage] = useState<number>(
    Math.max(1, Number(searchParams.get('page')) || 1),
  );

  // ── Derived: are any filters active? ───────
  const hasActiveFilters = useMemo(
    () => Boolean(filters.status || filters.severity || filters.timeframe || filters.overdue || filters.search),
    [filters],
  );

  // ── Build API URL from state ───────────────
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    params.set('sort', sortField);
    params.set('order', sortOrder);

    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.status) params.set('status', filters.status);
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.timeframe) params.set('timeframe', filters.timeframe);
    if (filters.overdue) params.set('overdue', filters.overdue);

    return `/api/v1/defects?${params.toString()}`;
  }, [page, sortField, sortOrder, filters]);

  // ── Fetch data ─────────────────────────────
  const { data, loading, error, refetch } = useFetch<DefectListResponse>(apiUrl);

  // ── Sync state → URL search params ─────────
  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page));
    if (sortField !== 'severity') params.set('sort', sortField);
    if (sortOrder !== 'desc') params.set('order', sortOrder);
    if (filters.search) params.set('search', filters.search);
    if (filters.status) params.set('status', filters.status);
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.timeframe) params.set('timeframe', filters.timeframe);
    if (filters.overdue) params.set('overdue', filters.overdue);

    setSearchParams(params, { replace: true });
  }, [page, sortField, sortOrder, filters, setSearchParams]);

  // ── Handlers ───────────────────────────────
  const handleFilterChange = useCallback((key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
    setPage(1);
  }, []);

  const handleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
      } else {
        setSortField(field);
        setSortOrder('desc');
      }
      setPage(1);
    },
    [sortField],
  );

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ── Derived data ───────────────────────────
  const defects = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: PAGE_SIZE, total: 0, total_pages: 0 };
  const summary = data?.summary ?? null;

  // ── Render ─────────────────────────────────
  return (
    <>
      <Helmet>
        <title>Defect Tracker — InspectVoice</title>
        <meta name="description" content="Track and manage all defects across your playground and park assets." />
      </Helmet>

      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-iv-text">Defect Tracker</h1>
              <p className="text-xs text-iv-muted mt-0.5">
                {loading
                  ? 'Loading…'
                  : `${pagination.total} defect${pagination.total !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DefectExportButton
              filters={{
                status: filters.status || undefined,
                severity: filters.severity || undefined,
              }}
            />
            <button
              type="button"
              onClick={refetch}
              disabled={loading}
              className="iv-btn-icon"
              aria-label="Refresh defects"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <SummaryCards summary={summary} />

        {/* Filters */}
        <FilterBar
          filters={filters}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
          hasActiveFilters={hasActiveFilters}
        />

        {/* Loading state */}
        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-16 text-iv-muted">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">Loading defects…</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-red-400 mb-1">Failed to load defects</p>
            <p className="text-xs text-iv-muted mb-4">{error.message}</p>
            <button
              type="button"
              onClick={refetch}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-iv-surface border border-iv-border rounded-lg text-sm font-medium text-iv-text hover:bg-iv-surface-2 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && defects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-iv-muted">
            <Inbox className="w-10 h-10 mb-3 text-iv-muted-2" />
            <p className="text-sm font-medium text-iv-text mb-1">
              {hasActiveFilters ? 'No defects match your filters' : 'No defects recorded'}
            </p>
            <p className="text-xs text-iv-muted">
              {hasActiveFilters
                ? 'Try adjusting your filters or clearing them.'
                : 'Defects are created automatically when inspections identify issues.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-iv-surface border border-iv-border rounded-lg text-sm font-medium text-iv-text hover:bg-iv-surface-2 transition-colors"
              >
                <X className="w-4 h-4" />
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Results */}
        {!error && defects.length > 0 && (
          <>
            {/* Desktop table (hidden on mobile) */}
            <div className="hidden lg:block bg-iv-surface border border-iv-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full" role="table">
                  <thead>
                    <tr className="border-b border-iv-border bg-iv-surface-2/50">
                      <th className="py-3 px-4 text-left">
                        <SortButton field="severity" label="Severity" currentSort={sortField} currentOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th className="py-3 px-4 text-left">
                        <span className="text-xs font-medium text-iv-muted">Description</span>
                      </th>
                      <th className="py-3 px-4 text-left">
                        <span className="text-xs font-medium text-iv-muted">Site / Asset</span>
                      </th>
                      <th className="py-3 px-4 text-left">
                        <SortButton field="action_timeframe" label="Timeframe" currentSort={sortField} currentOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th className="py-3 px-4 text-left">
                        <SortButton field="status" label="Status" currentSort={sortField} currentOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th className="py-3 px-4 text-left">
                        <span className="text-xs font-medium text-iv-muted">Assigned</span>
                      </th>
                      <th className="py-3 px-4 text-left">
                        <SortButton field="due_date" label="Due Date" currentSort={sortField} currentOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th className="py-3 px-4 text-left">
                        <span className="text-xs font-medium text-iv-muted">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {defects.map((defect) => (
                      <DefectRow key={defect.id} defect={defect} onRefresh={refetch} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile cards (hidden on desktop) */}
            <div className="lg:hidden space-y-3">
              {defects.map((defect) => (
                <DefectCard key={defect.id} defect={defect} onRefresh={refetch} />
              ))}
            </div>

            {/* Pagination */}
            <Pagination
              page={pagination.page}
              totalPages={pagination.total_pages}
              total={pagination.total}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </div>
    </>
  );
}

export default DefectTracker;
