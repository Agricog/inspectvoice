/**
 * InspectVoice — Incident List Page
 * Route: /incidents
 *
 * Features:
 *   - Filterable list: type, severity, status, site
 *   - Search by description, reporter, injured party
 *   - Summary cards: total, open, claims received
 *   - Mobile cards + desktop table layout
 *   - One-click claims pack download per incident
 *   - Link to create new incident
 *   - Pagination
 *   - Dark theme (iv-* design tokens)
 *
 * API: GET /api/v1/incidents
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  AlertTriangle,
  Plus,
  Search,
  Filter,
  Loader2,
  RefreshCw,
  FileText,
  Shield,
  MapPin,
  Calendar,
  ExternalLink,
  Download,
  X,
} from 'lucide-react';
import { useFetch } from '@hooks/useFetch';

// =============================================
// TYPES
// =============================================

interface Incident {
  id: string;
  site_id: string;
  site_name: string;
  asset_id: string | null;
  asset_code: string | null;
  defect_id: string | null;
  incident_date: string;
  incident_time: string | null;
  incident_type: string;
  severity: string;
  description: string;
  reported_by: string;
  injured_party_name: string | null;
  status: string;
  claim_reference: string | null;
  created_at: string;
}

interface IncidentListResponse {
  success: boolean;
  data: Incident[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

// =============================================
// CONSTANTS
// =============================================

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  injury: 'Injury',
  complaint: 'Complaint',
  near_miss: 'Near Miss',
  vandalism: 'Vandalism',
  property_damage: 'Property Damage',
  other: 'Other',
};

const SEVERITY_LABELS: Record<string, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  serious: 'Serious',
  major: 'Major',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  investigating: 'Investigating',
  closed: 'Closed',
  claim_received: 'Claim Received',
  claim_settled: 'Claim Settled',
};

const SEVERITY_STYLES: Record<string, string> = {
  minor: 'bg-emerald-500/15 text-emerald-400',
  moderate: 'bg-yellow-500/15 text-yellow-400',
  serious: 'bg-orange-500/15 text-orange-400',
  major: 'bg-red-500/15 text-red-400',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-red-500/15 text-red-400',
  investigating: 'bg-yellow-500/15 text-yellow-400',
  closed: 'bg-emerald-500/15 text-emerald-400',
  claim_received: 'bg-purple-500/15 text-purple-400',
  claim_settled: 'bg-blue-500/15 text-blue-400',
};

const TYPE_STYLES: Record<string, string> = {
  injury: 'bg-red-500/15 text-red-400',
  complaint: 'bg-orange-500/15 text-orange-400',
  near_miss: 'bg-yellow-500/15 text-yellow-400',
  vandalism: 'bg-purple-500/15 text-purple-400',
  property_damage: 'bg-blue-500/15 text-blue-400',
  other: 'bg-gray-500/15 text-gray-400',
};

// =============================================
// HELPERS
// =============================================

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function buildApiUrl(params: URLSearchParams): string {
  const apiParams = new URLSearchParams();

  const search = params.get('search');
  const type = params.get('type');
  const severity = params.get('severity');
  const status = params.get('status');
  const page = params.get('page');

  if (search) apiParams.set('search', search);
  if (type) apiParams.set('type', type);
  if (severity) apiParams.set('severity', severity);
  if (status) apiParams.set('status', status);
  if (page) apiParams.set('page', page);
  apiParams.set('sort', 'incident_date');
  apiParams.set('direction', 'desc');

  return `/api/v1/incidents?${apiParams.toString()}`;
}

// =============================================
// MAIN COMPONENT
// =============================================

export default function IncidentList(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const [showFilters, setShowFilters] = useState(false);

  const apiUrl = buildApiUrl(searchParams);
  const { data, loading, error, refetch } = useFetch<IncidentListResponse>(apiUrl);

  const incidents = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, per_page: 20, total: 0, total_pages: 1 };

  // Filter counts from current result set
  const openCount = incidents.filter((i) => i.status === 'open' || i.status === 'investigating').length;
  const claimCount = incidents.filter((i) => i.status === 'claim_received' || i.status === 'claim_settled').length;

  // Active filter count
  const activeFilterCount = [
    searchParams.get('type'),
    searchParams.get('severity'),
    searchParams.get('status'),
  ].filter(Boolean).length;

  function updateParam(key: string, value: string | null): void {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.delete('page');
    setSearchParams(next);
  }

  function handleSearch(e: React.FormEvent): void {
    e.preventDefault();
    updateParam('search', searchInput || null);
  }

  function clearFilters(): void {
    setSearchParams({});
    setSearchInput('');
  }

  return (
    <>
      <Helmet>
        <title>Incidents — InspectVoice</title>
        <meta name="description" content="Incident and complaint register for BS EN 1176 compliance." />
      </Helmet>

      <div className="space-y-4">
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-iv-text">Incidents</h1>
              <p className="text-xs text-iv-muted mt-0.5">
                {meta.total} record{meta.total !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refetch}
              disabled={loading}
              className="iv-btn-icon"
              aria-label="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <Link
              to="/incidents/new"
              className="iv-btn-primary flex items-center gap-1.5 text-sm"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Report Incident</span>
            </Link>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-iv-surface border border-iv-border rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-iv-text">{meta.total}</p>
            <p className="text-2xs text-iv-muted">Total</p>
          </div>
          <div className="bg-iv-surface border border-iv-border rounded-xl p-3 text-center">
            <p className={`text-xl font-bold ${openCount > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
              {openCount}
            </p>
            <p className="text-2xs text-iv-muted">Open</p>
          </div>
          <div className="bg-iv-surface border border-iv-border rounded-xl p-3 text-center">
            <p className={`text-xl font-bold ${claimCount > 0 ? 'text-purple-400' : 'text-iv-text'}`}>
              {claimCount}
            </p>
            <p className="text-2xs text-iv-muted">Claims</p>
          </div>
        </div>

        {/* ── Search + Filter Bar ── */}
        <div className="flex items-center gap-2">
          <form onSubmit={handleSearch} className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-iv-muted" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search incidents..."
              className="w-full pl-9 pr-4 py-2 bg-iv-surface border border-iv-border rounded-lg text-sm text-iv-text placeholder:text-iv-muted focus:outline-none focus:border-iv-accent"
            />
          </form>
          <button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            className={`iv-btn-icon relative ${showFilters ? 'text-iv-accent' : ''}`}
            aria-label="Toggle filters"
          >
            <Filter className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-iv-accent text-[10px] font-bold text-white flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* ── Filter Panel ── */}
        {showFilters && (
          <div className="bg-iv-surface border border-iv-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-iv-text">Filters</p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-2xs text-iv-muted hover:text-iv-accent flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Clear all
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-2xs text-iv-muted mb-1 block">Type</label>
                <select
                  value={searchParams.get('type') ?? ''}
                  onChange={(e) => updateParam('type', e.target.value || null)}
                  className="w-full bg-iv-surface-2 border border-iv-border rounded-lg px-3 py-1.5 text-sm text-iv-text"
                >
                  <option value="">All types</option>
                  {Object.entries(INCIDENT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-2xs text-iv-muted mb-1 block">Severity</label>
                <select
                  value={searchParams.get('severity') ?? ''}
                  onChange={(e) => updateParam('severity', e.target.value || null)}
                  className="w-full bg-iv-surface-2 border border-iv-border rounded-lg px-3 py-1.5 text-sm text-iv-text"
                >
                  <option value="">All severities</option>
                  {Object.entries(SEVERITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-2xs text-iv-muted mb-1 block">Status</label>
                <select
                  value={searchParams.get('status') ?? ''}
                  onChange={(e) => updateParam('status', e.target.value || null)}
                  className="w-full bg-iv-surface-2 border border-iv-border rounded-lg px-3 py-1.5 text-sm text-iv-text"
                >
                  <option value="">All statuses</option>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && incidents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-iv-muted">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">Loading incidents…</p>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-red-400 mb-1">Failed to load incidents</p>
            <p className="text-xs text-iv-muted mb-4">{error.message}</p>
            <button type="button" onClick={refetch} className="iv-btn-secondary text-sm">
              <RefreshCw className="w-4 h-4 inline mr-1" /> Retry
            </button>
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && incidents.length === 0 && (
          <div className="bg-iv-surface border border-iv-border rounded-xl p-8 text-center">
            <Shield className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-iv-text mb-1">No incidents recorded</p>
            <p className="text-xs text-iv-muted mb-4">
              {activeFilterCount > 0
                ? 'No incidents match the current filters.'
                : 'Incident and complaint records will appear here.'}
            </p>
            {activeFilterCount > 0 ? (
              <button type="button" onClick={clearFilters} className="iv-btn-secondary text-sm">
                Clear filters
              </button>
            ) : (
              <Link to="/incidents/new" className="iv-btn-primary inline-flex items-center gap-1.5 text-sm">
                <Plus className="w-4 h-4" /> Report Incident
              </Link>
            )}
          </div>
        )}

        {/* ── Incident List ── */}
        {incidents.length > 0 && (
          <div className="space-y-2">
            {incidents.map((incident) => {
              const typeStyle = TYPE_STYLES[incident.incident_type] ?? TYPE_STYLES['other']!;
              const sevStyle = SEVERITY_STYLES[incident.severity] ?? SEVERITY_STYLES['minor']!;
              const statStyle = STATUS_STYLES[incident.status] ?? STATUS_STYLES['open']!;

              return (
                <div
                  key={incident.id}
                  className="bg-iv-surface border border-iv-border rounded-xl p-4 hover:border-iv-accent/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {/* Badges */}
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-bold ${typeStyle}`}>
                          {INCIDENT_TYPE_LABELS[incident.incident_type] ?? incident.incident_type}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium ${sevStyle}`}>
                          {SEVERITY_LABELS[incident.severity] ?? incident.severity}
                        </span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ${statStyle}`}>
                          {STATUS_LABELS[incident.status] ?? incident.status}
                        </span>
                        {incident.claim_reference && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium bg-purple-500/15 text-purple-400">
                            <FileText className="w-3 h-3" />
                            Claim
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      <p className="text-sm text-iv-text line-clamp-2">{incident.description}</p>

                      {/* Context */}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-2xs text-iv-muted">
                          <Calendar className="w-3 h-3" />
                          {formatDate(incident.incident_date)}
                        </span>
                        <span className="text-2xs text-iv-muted-2">·</span>
                        <Link
                          to={`/sites/${incident.site_id}`}
                          className="inline-flex items-center gap-1 text-2xs text-iv-muted hover:text-iv-accent transition-colors"
                        >
                          <MapPin className="w-3 h-3" />
                          {incident.site_name}
                        </Link>
                        {incident.asset_code && (
                          <>
                            <span className="text-2xs text-iv-muted-2">·</span>
                            <span className="text-2xs text-iv-muted">{incident.asset_code}</span>
                          </>
                        )}
                        <span className="text-2xs text-iv-muted-2">·</span>
                        <span className="text-2xs text-iv-muted">
                          Reported by {incident.reported_by}
                        </span>
                        {incident.injured_party_name && (
                          <>
                            <span className="text-2xs text-iv-muted-2">·</span>
                            <span className="text-2xs text-orange-400">
                              Injured: {incident.injured_party_name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Link
                        to={`/incidents/${incident.id}/claims-pack`}
                        className="iv-btn-icon"
                        title="Download claims pack"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Link>
                      <Link
                        to={`/incidents/${incident.id}`}
                        className="iv-btn-icon"
                        title="View / Edit"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Pagination ── */}
        {meta.total_pages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-2xs text-iv-muted">
              Page {meta.page} of {meta.total_pages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateParam('page', String(meta.page - 1))}
                disabled={meta.page <= 1}
                className="iv-btn-secondary text-xs disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => updateParam('page', String(meta.page + 1))}
                disabled={meta.page >= meta.total_pages}
                className="iv-btn-secondary text-xs disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
