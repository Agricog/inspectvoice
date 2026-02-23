/**
 * InspectVoice — Site List Page
 * Displays all sites with search, filter by type/status, and sort.
 * Loads from IndexedDB cache (offline-first), refreshes from API when online.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Plus,
  Search,
  MapPin,
  ChevronRight,
  Filter,
  TreePine,
  Dumbbell,
  LayoutGrid,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { sitesCache } from '@services/offlineStore';
import { captureError } from '@utils/errorTracking';
import { trackPageView } from '@utils/analytics';
import {
  SiteType,
  SiteStatus,
  SITE_TYPE_LABELS,
} from '@/types';
import type { CachedSite } from '@/types';

// =============================================
// FILTER STATE
// =============================================

type SortField = 'name' | 'updated_at' | 'site_type';
type SortDirection = 'asc' | 'desc';

interface Filters {
  search: string;
  siteType: SiteType | 'all';
  status: SiteStatus | 'all';
  sortField: SortField;
  sortDirection: SortDirection;
}

const DEFAULT_FILTERS: Filters = {
  search: '',
  siteType: 'all',
  status: 'all',
  sortField: 'name',
  sortDirection: 'asc',
};

// =============================================
// SITE TYPE ICONS
// =============================================

function SiteTypeIcon({ siteType }: { siteType: SiteType }): JSX.Element {
  switch (siteType) {
    case SiteType.PLAYGROUND:
    case SiteType.PARK:
    case SiteType.MIXED:
      return <TreePine className="w-4 h-4" />;
    case SiteType.OUTDOOR_GYM:
      return <Dumbbell className="w-4 h-4" />;
    default:
      return <LayoutGrid className="w-4 h-4" />;
  }
}

// =============================================
// COMPONENT
// =============================================

export function SiteList(): JSX.Element {
  const [sites, setSites] = useState<CachedSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  // Track page view
  useEffect(() => {
    trackPageView('/sites');
  }, []);

  // Load sites from cache
  useEffect(() => {
    async function loadSites(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const cached = await sitesCache.getAll();
        setSites(cached);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load sites';
        setError(message);
        captureError(err, { module: 'SiteList', operation: 'loadSites' });
      } finally {
        setLoading(false);
      }
    }

    void loadSites();
  }, []);

  // Filter and sort
  const filteredSites = useMemo(() => {
    let result = sites.map((cached) => cached.data);

    // Search
    if (filters.search.trim()) {
      const query = filters.search.toLowerCase().trim();
      result = result.filter(
        (site) =>
          site.name.toLowerCase().includes(query) ||
          site.address.toLowerCase().includes(query) ||
          (site.postcode?.toLowerCase().includes(query) ?? false) ||
          (site.site_code?.toLowerCase().includes(query) ?? false),
      );
    }

    // Site type filter
    if (filters.siteType !== 'all') {
      result = result.filter((site) => site.site_type === filters.siteType);
    }

    // Status filter
    if (filters.status !== 'all') {
      result = result.filter((site) => site.status === filters.status);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;

      switch (filters.sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'updated_at':
          comparison = a.updated_at.localeCompare(b.updated_at);
          break;
        case 'site_type':
          comparison = a.site_type.localeCompare(b.site_type);
          break;
      }

      return filters.sortDirection === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [sites, filters]);

  const updateFilter = useCallback(
    <K extends keyof Filters>(key: K, value: Filters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.siteType !== 'all') count++;
    if (filters.status !== 'all') count++;
    return count;
  }, [filters]);

  // =========================================
  // RENDER
  // =========================================

  return (
    <>
      <Helmet>
        <title>Sites — InspectVoice</title>
        <meta name="description" content="Manage inspection sites — parks, playgrounds, outdoor gyms and recreation areas." />
      </Helmet>

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-iv-text">Sites</h1>
          <p className="text-sm text-iv-muted mt-0.5">
            {loading ? 'Loading...' : `${filteredSites.length} site${filteredSites.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        <Link to="/sites/new" className="iv-btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add Site</span>
        </Link>
      </div>

      {/* Search + filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-iv-muted-2" />
          <input
            type="search"
            placeholder="Search by name, address, postcode, or site code..."
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="iv-input pl-10"
            aria-label="Search sites"
          />
        </div>

        <button
          type="button"
          className={`iv-btn-secondary relative ${showFilters ? 'border-iv-accent text-iv-accent' : ''}`}
          onClick={() => setShowFilters((prev) => !prev)}
          aria-expanded={showFilters}
        >
          <Filter className="w-4 h-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-iv-accent text-iv-bg text-2xs font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="iv-panel p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-4 animate-slide-up">
          <div>
            <label htmlFor="filter-type" className="iv-label">Site Type</label>
            <select
              id="filter-type"
              className="iv-select"
              value={filters.siteType}
              onChange={(e) => updateFilter('siteType', e.target.value as SiteType | 'all')}
            >
              <option value="all">All types</option>
              {Object.values(SiteType).map((type) => (
                <option key={type} value={type}>{SITE_TYPE_LABELS[type]}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-status" className="iv-label">Status</label>
            <select
              id="filter-status"
              className="iv-select"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value as SiteStatus | 'all')}
            >
              <option value="all">All statuses</option>
              <option value={SiteStatus.ACTIVE}>Active</option>
              <option value={SiteStatus.ARCHIVED}>Archived</option>
              <option value={SiteStatus.TEMPORARY_CLOSURE}>Temporary Closure</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-sort" className="iv-label">Sort By</label>
            <select
              id="filter-sort"
              className="iv-select"
              value={`${filters.sortField}:${filters.sortDirection}`}
              onChange={(e) => {
                const [field, direction] = e.target.value.split(':') as [SortField, SortDirection];
                setFilters((prev) => ({ ...prev, sortField: field, sortDirection: direction }));
              }}
            >
              <option value="name:asc">Name (A-Z)</option>
              <option value="name:desc">Name (Z-A)</option>
              <option value="updated_at:desc">Recently updated</option>
              <option value="site_type:asc">Site type</option>
            </select>
          </div>
        </div>
      )}

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-iv-accent animate-spin" />
          <span className="ml-3 text-sm text-iv-muted">Loading sites...</span>
        </div>
      )}

      {error && (
        <div className="iv-panel p-6 text-center">
          <AlertCircle className="w-8 h-8 text-risk-high mx-auto mb-3" />
          <p className="text-sm text-risk-high font-medium mb-1">Failed to load sites</p>
          <p className="text-sm text-iv-muted">{error}</p>
        </div>
      )}

      {!loading && !error && filteredSites.length === 0 && (
        <div className="iv-panel p-8 text-center">
          <MapPin className="w-10 h-10 text-iv-muted-2 mx-auto mb-4" />
          {sites.length === 0 ? (
            <>
              <p className="text-sm font-medium text-iv-text mb-1">No sites yet</p>
              <p className="text-sm text-iv-muted mb-4">
                Add your first inspection site to get started.
              </p>
              <Link to="/sites/new" className="iv-btn-primary">
                <Plus className="w-4 h-4" />
                Add First Site
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-iv-text mb-1">No sites match filters</p>
              <p className="text-sm text-iv-muted">
                Try adjusting your search or filters.
              </p>
            </>
          )}
        </div>
      )}

      {!loading && !error && filteredSites.length > 0 && (
        <div className="space-y-2">
          {filteredSites.map((site) => (
            <Link
              key={site.id}
              to={`/sites/${site.id}`}
              className="iv-card-interactive flex items-center gap-4"
            >
              {/* Icon */}
              <div className="w-10 h-10 rounded-lg bg-iv-accent/10 flex items-center justify-center shrink-0 text-iv-accent">
                <SiteTypeIcon siteType={site.site_type} />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-iv-text truncate">
                    {site.name}
                  </h3>
                  {site.status === SiteStatus.TEMPORARY_CLOSURE && (
                    <span className="iv-badge bg-risk-medium/15 text-risk-medium">Closed</span>
                  )}
                  {site.status === SiteStatus.ARCHIVED && (
                    <span className="iv-badge bg-iv-muted-2/20 text-iv-muted-2">Archived</span>
                  )}
                </div>
                <p className="text-sm text-iv-muted truncate">{site.address}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-2xs text-iv-muted-2">
                    {SITE_TYPE_LABELS[site.site_type]}
                  </span>
                  {site.postcode && (
                    <span className="text-2xs text-iv-muted-2">{site.postcode}</span>
                  )}
                  {site.site_code && (
                    <span className="text-2xs text-iv-muted-2">Code: {site.site_code}</span>
                  )}
                </div>
              </div>

              {/* Arrow */}
              <ChevronRight className="w-5 h-5 text-iv-muted-2 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
