/**
 * InspectVoice — Inspection List Page
 * All inspections across all sites with filtering, sorting, and pagination.
 *
 * Route: /inspections
 * Replaces placeholder in App.tsx
 *
 * Features:
 * - Filter by status, inspection type, date range
 * - Search by site name or inspector
 * - Sort by date, status, risk rating
 * - Paginated results (server-side)
 * - Risk rating and status badges
 * - Responsive: cards on mobile, table on desktop
 * - Loading, error, and empty states
 * - Links to inspection review/capture
 *
 * API: GET /api/inspections?page=1&limit=20&status=...&type=...&search=...&sort=...&order=...
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ClipboardCheck,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  ArrowUpDown,
  Eye,
  Pencil,
  FileText,
  Calendar,
  MapPin,
  User,
  X,
  Loader2,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import { useFetch } from '@hooks/useFetch';
import type { Inspection } from '@/types/entities';
import {
  InspectionStatus,
  InspectionType,
  RiskRating,
  INSPECTION_STATUS_LABELS,
  INSPECTION_TYPE_LABELS,
  RISK_RATING_LABELS,
} from '@/types/enums';

// =============================================
// TYPES
// =============================================

/** Extended inspection with joined display fields from API */
interface InspectionListItem extends Inspection {
  site_name: string;
  inspector_name: string;
}

interface InspectionListResponse {
  data: InspectionListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

type SortField = 'inspection_date' | 'status' | 'overall_risk_rating' | 'inspection_type';
type SortOrder = 'asc' | 'desc';

// =============================================
// CONSTANTS
// =============================================

const PAGE_SIZE = 20;

const STATUS_STYLES: Record<InspectionStatus, { bg: string; text: string }> = {
  [InspectionStatus.DRAFT]: { bg: 'bg-iv-muted/15', text: 'text-iv-muted' },
  [InspectionStatus.REVIEW]: { bg: 'bg-iv-accent/15', text: 'text-iv-accent' },
  [InspectionStatus.SIGNED]: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  [InspectionStatus.EXPORTED]: { bg: 'bg-purple-500/15', text: 'text-purple-400' },
};

const RISK_STYLES: Record<RiskRating, { bg: string; text: string; dot: string }> = {
  [RiskRating.VERY_HIGH]: { bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-400' },
  [RiskRating.HIGH]: { bg: 'bg-orange-500/15', text: 'text-orange-400', dot: 'bg-orange-400' },
  [RiskRating.MEDIUM]: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  [RiskRating.LOW]: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
};

// =============================================
// HELPER COMPONENTS
// =============================================

function StatusBadge({ status }: { status: InspectionStatus }): JSX.Element {
  const style = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      {INSPECTION_STATUS_LABELS[status]}
    </span>
  );
}

function RiskBadge({ rating }: { rating: RiskRating | null }): JSX.Element {
  if (!rating) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-iv-muted/10 text-iv-muted-2">
        Not assessed
      </span>
    );
  }
  const style = RISK_STYLES[rating];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {RISK_RATING_LABELS[rating]}
    </span>
  );
}

function DefectSummary({ inspection }: { inspection: InspectionListItem }): JSX.Element {
  const { very_high_risk_count, high_risk_count, medium_risk_count, low_risk_count, total_defects } = inspection;

  if (total_defects === 0) {
    return <span className="text-xs text-iv-muted-2">No defects</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      {very_high_risk_count > 0 && (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded text-2xs font-bold bg-red-500/20 text-red-400" title={`${very_high_risk_count} very high risk`}>
          {very_high_risk_count}
        </span>
      )}
      {high_risk_count > 0 && (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded text-2xs font-bold bg-orange-500/20 text-orange-400" title={`${high_risk_count} high risk`}>
          {high_risk_count}
        </span>
      )}
      {medium_risk_count > 0 && (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded text-2xs font-bold bg-yellow-500/20 text-yellow-400" title={`${medium_risk_count} medium risk`}>
          {medium_risk_count}
        </span>
      )}
      {low_risk_count > 0 && (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded text-2xs font-bold bg-emerald-500/20 text-emerald-400" title={`${low_risk_count} low risk`}>
          {low_risk_count}
        </span>
      )}
      <span className="text-2xs text-iv-muted ml-0.5">
        ({total_defects})
      </span>
    </div>
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
// FILTER BAR
// =============================================

interface FilterState {
  search: string;
  status: InspectionStatus | '';
  type: InspectionType | '';
  dateFrom: string;
  dateTo: string;
}

const INITIAL_FILTERS: FilterState = {
  search: '',
  status: '',
  type: '',
  dateFrom: '',
  dateTo: '',
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
        {/* Search input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-iv-muted" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onFilterChange('search', e.target.value)}
            placeholder="Search by site name or inspector…"
            className="w-full pl-9 pr-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted-2 focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            aria-label="Search inspections"
          />
        </div>

        {/* Filter toggle */}
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className={`iv-btn-icon relative ${expanded ? 'text-iv-accent' : ''}`}
          aria-expanded={expanded}
          aria-controls="inspection-filters"
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
          id="inspection-filters"
          className="px-3 pb-3 border-t border-iv-border pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
        >
          {/* Status filter */}
          <div>
            <label htmlFor="filter-status" className="block text-2xs font-medium text-iv-muted mb-1">
              Status
            </label>
            <select
              id="filter-status"
              value={filters.status}
              onChange={(e) => onFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            >
              <option value="">All statuses</option>
              {Object.values(InspectionStatus).map((status) => (
                <option key={status} value={status}>
                  {INSPECTION_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>

          {/* Type filter */}
          <div>
            <label htmlFor="filter-type" className="block text-2xs font-medium text-iv-muted mb-1">
              Inspection Type
            </label>
            <select
              id="filter-type"
              value={filters.type}
              onChange={(e) => onFilterChange('type', e.target.value)}
              className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            >
              <option value="">All types</option>
              {Object.values(InspectionType).map((type) => (
                <option key={type} value={type}>
                  {INSPECTION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div>
            <label htmlFor="filter-date-from" className="block text-2xs font-medium text-iv-muted mb-1">
              From Date
            </label>
            <input
              id="filter-date-from"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => onFilterChange('dateFrom', e.target.value)}
              className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            />
          </div>

          {/* Date to */}
          <div>
            <label htmlFor="filter-date-to" className="block text-2xs font-medium text-iv-muted mb-1">
              To Date
            </label>
            <input
              id="filter-date-to"
              type="date"
              value={filters.dateTo}
              onChange={(e) => onFilterChange('dateTo', e.target.value)}
              className="w-full px-3 py-2 bg-iv-surface-2 border border-iv-border rounded-lg text-sm text-iv-text focus:outline-none focus:ring-2 focus:ring-iv-accent/40 focus:border-iv-accent/40 transition-colors"
            />
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
        {startItem}–{endItem} of {total} inspections
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
// INSPECTION CARD (Mobile)
// =============================================

function InspectionCard({ inspection }: { inspection: InspectionListItem }): JSX.Element {
  const inspectionDate = new Date(inspection.inspection_date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const actionUrl = inspection.status === InspectionStatus.DRAFT
    ? `/sites/${inspection.site_id}/inspections/${inspection.id}/capture`
    : `/sites/${inspection.site_id}/inspections/${inspection.id}/review`;

  return (
    <div className="bg-iv-surface border border-iv-border rounded-xl p-4 hover:border-iv-accent/30 transition-colors">
      {/* Header row: type + status */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <Link
            to={actionUrl}
            className="text-sm font-semibold text-iv-text hover:text-iv-accent transition-colors line-clamp-1"
          >
            {INSPECTION_TYPE_LABELS[inspection.inspection_type]}
          </Link>
          <div className="flex items-center gap-1.5 mt-1">
            <MapPin className="w-3 h-3 text-iv-muted shrink-0" />
            <Link
              to={`/sites/${inspection.site_id}`}
              className="text-xs text-iv-muted hover:text-iv-accent transition-colors line-clamp-1"
            >
              {inspection.site_name}
            </Link>
          </div>
        </div>
        <StatusBadge status={inspection.status} />
      </div>

      {/* Detail rows */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3 h-3 text-iv-muted shrink-0" />
          <span className="text-xs text-iv-muted">{inspectionDate}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <User className="w-3 h-3 text-iv-muted shrink-0" />
          <span className="text-xs text-iv-muted">{inspection.inspector_name}</span>
        </div>
      </div>

      {/* Footer: risk + defects */}
      <div className="flex items-center justify-between pt-3 border-t border-iv-border">
        <RiskBadge rating={inspection.overall_risk_rating} />
        <DefectSummary inspection={inspection} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-iv-border">
        <Link
          to={actionUrl}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-iv-accent/10 text-iv-accent rounded-lg text-xs font-medium hover:bg-iv-accent/20 transition-colors"
        >
          {inspection.status === InspectionStatus.DRAFT ? (
            <>
              <Pencil className="w-3 h-3" />
              Continue
            </>
          ) : (
            <>
              <Eye className="w-3 h-3" />
              Review
            </>
          )}
        </Link>
        {inspection.pdf_url && (
          <a
            href={inspection.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-iv-surface-2 text-iv-muted rounded-lg text-xs font-medium hover:text-iv-text hover:bg-iv-border transition-colors"
            title="Download PDF"
          >
            <FileText className="w-3 h-3" />
            PDF
          </a>
        )}
      </div>
    </div>
  );
}

// =============================================
// INSPECTION TABLE ROW (Desktop)
// =============================================

function InspectionRow({ inspection }: { inspection: InspectionListItem }): JSX.Element {
  const inspectionDate = new Date(inspection.inspection_date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const actionUrl = inspection.status === InspectionStatus.DRAFT
    ? `/sites/${inspection.site_id}/inspections/${inspection.id}/capture`
    : `/sites/${inspection.site_id}/inspections/${inspection.id}/review`;

  return (
    <tr className="border-b border-iv-border last:border-b-0 hover:bg-iv-surface-2/50 transition-colors">
      {/* Date */}
      <td className="py-3 px-4">
        <span className="text-sm text-iv-text whitespace-nowrap">{inspectionDate}</span>
      </td>

      {/* Site */}
      <td className="py-3 px-4">
        <Link
          to={`/sites/${inspection.site_id}`}
          className="text-sm text-iv-text hover:text-iv-accent transition-colors line-clamp-1"
        >
          {inspection.site_name}
        </Link>
      </td>

      {/* Type */}
      <td className="py-3 px-4">
        <span className="text-sm text-iv-muted whitespace-nowrap">
          {INSPECTION_TYPE_LABELS[inspection.inspection_type]}
        </span>
      </td>

      {/* Inspector */}
      <td className="py-3 px-4">
        <span className="text-sm text-iv-muted line-clamp-1">
          {inspection.inspector_name}
        </span>
      </td>

      {/* Status */}
      <td className="py-3 px-4">
        <StatusBadge status={inspection.status} />
      </td>

      {/* Risk */}
      <td className="py-3 px-4">
        <RiskBadge rating={inspection.overall_risk_rating} />
      </td>

      {/* Defects */}
      <td className="py-3 px-4">
        <DefectSummary inspection={inspection} />
      </td>

      {/* Actions */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-1.5 justify-end">
          <Link
            to={actionUrl}
            className="iv-btn-icon"
            title={inspection.status === InspectionStatus.DRAFT ? 'Continue inspection' : 'Review inspection'}
          >
            {inspection.status === InspectionStatus.DRAFT ? (
              <Pencil className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </Link>
          {inspection.pdf_url && (
            <a
              href={inspection.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="iv-btn-icon"
              title="Download PDF"
            >
              <FileText className="w-4 h-4" />
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

// =============================================
// MAIN PAGE COMPONENT
// =============================================

export function InspectionList(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── State ──────────────────────────────────
  const [filters, setFilters] = useState<FilterState>(() => ({
    search: searchParams.get('search') ?? '',
    status: (searchParams.get('status') as InspectionStatus) ?? '',
    type: (searchParams.get('type') as InspectionType) ?? '',
    dateFrom: searchParams.get('from') ?? '',
    dateTo: searchParams.get('to') ?? '',
  }));

  const [sortField, setSortField] = useState<SortField>(
    (searchParams.get('sort') as SortField) ?? 'inspection_date',
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    (searchParams.get('order') as SortOrder) ?? 'desc',
  );
  const [page, setPage] = useState<number>(
    Math.max(1, Number(searchParams.get('page')) || 1),
  );

  // ── Derived: are any filters active? ───────
  const hasActiveFilters = useMemo(
    () => Boolean(filters.status || filters.type || filters.dateFrom || filters.dateTo || filters.search),
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
    if (filters.type) params.set('type', filters.type);
    if (filters.dateFrom) params.set('from', filters.dateFrom);
    if (filters.dateTo) params.set('to', filters.dateTo);

    return `/api/v1/inspections?${params.toString()}`;
  }, [page, sortField, sortOrder, filters]);

  // ── Fetch data ─────────────────────────────
  const { data, loading, error, refetch } = useFetch<InspectionListResponse>(apiUrl);

  // ── Sync state → URL search params ─────────
  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page));
    if (sortField !== 'inspection_date') params.set('sort', sortField);
    if (sortOrder !== 'desc') params.set('order', sortOrder);
    if (filters.search) params.set('search', filters.search);
    if (filters.status) params.set('status', filters.status);
    if (filters.type) params.set('type', filters.type);
    if (filters.dateFrom) params.set('from', filters.dateFrom);
    if (filters.dateTo) params.set('to', filters.dateTo);

    setSearchParams(params, { replace: true });
  }, [page, sortField, sortOrder, filters, setSearchParams]);

  // ── Handlers ───────────────────────────────
  const handleFilterChange = useCallback((key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1); // Reset to page 1 on filter change
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
  const inspections = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: PAGE_SIZE, total: 0, total_pages: 0 };

  // ── Render ─────────────────────────────────
  return (
    <>
      <Helmet>
        <title>Inspections — InspectVoice</title>
        <meta name="description" content="View and manage all playground inspections across your sites." />
      </Helmet>

      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-iv-accent/15 flex items-center justify-center">
              <ClipboardCheck className="w-5 h-5 text-iv-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-iv-text">Inspections</h1>
              <p className="text-xs text-iv-muted mt-0.5">
                {loading
                  ? 'Loading…'
                  : `${pagination.total} inspection${pagination.total !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>

          {/* Refresh */}
          <button
            type="button"
            onClick={refetch}
            disabled={loading}
            className="iv-btn-icon"
            aria-label="Refresh inspections"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

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
            <p className="text-sm">Loading inspections…</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-red-400 mb-1">Failed to load inspections</p>
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
        {!loading && !error && inspections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-iv-muted">
            <Inbox className="w-10 h-10 mb-3 text-iv-muted-2" />
            <p className="text-sm font-medium text-iv-text mb-1">
              {hasActiveFilters ? 'No inspections match your filters' : 'No inspections yet'}
            </p>
            <p className="text-xs text-iv-muted">
              {hasActiveFilters
                ? 'Try adjusting your filters or clearing them.'
                : 'Start by navigating to a site and creating an inspection.'}
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
        {!error && inspections.length > 0 && (
          <>
            {/* Desktop table (hidden on mobile) */}
            <div className="hidden lg:block bg-iv-surface border border-iv-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full" role="table">
                  <thead>
                    <tr className="border-b border-iv-border bg-iv-surface-2/50">
                      <th className="py-3 px-4 text-left">
                        <SortButton field="inspection_date" label="Date" currentSort={sortField} currentOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th className="py-3 px-4 text-left">
                        <span className="text-xs font-medium text-iv-muted">Site</span>
                      </th>
                      <th className="py-3 px-4 text-left">
                        <SortButton field="inspection_type" label="Type" currentSort={sortField} currentOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th className="py-3 px-4 text-left">
                        <span className="text-xs font-medium text-iv-muted">Inspector</span>
                      </th>
                      <th className="py-3 px-4 text-left">
                        <SortButton field="status" label="Status" currentSort={sortField} currentOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th className="py-3 px-4 text-left">
                        <SortButton field="overall_risk_rating" label="Risk" currentSort={sortField} currentOrder={sortOrder} onSort={handleSort} />
                      </th>
                      <th className="py-3 px-4 text-left">
                        <span className="text-xs font-medium text-iv-muted">Defects</span>
                      </th>
                      <th className="py-3 px-4 text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspections.map((inspection) => (
                      <InspectionRow key={inspection.id} inspection={inspection} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile cards (hidden on desktop) */}
            <div className="lg:hidden space-y-3">
              {inspections.map((inspection) => (
                <InspectionCard key={inspection.id} inspection={inspection} />
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

export default InspectionList;
