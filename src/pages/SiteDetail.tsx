/**
 * InspectVoice — Site Detail Page
 * Displays site information, asset register, and inspection history.
 * Entry point for starting new inspections against this site.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import MapGL, { Marker, NavigationControl } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft,
  Edit,
  Plus,
  ClipboardCheck,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Clock,
  TreePine,
  Dumbbell,
  LayoutGrid,
  Package,
  AlertCircle,
  Loader2,
  ChevronRight,
  Info,
  Trash2,
} from 'lucide-react';
import { sitesCache, assetsCache, inspections as inspectionsStore } from '@services/offlineStore';
import { secureFetch } from '@hooks/useFetch';
import { captureError } from '@utils/errorTracking';
import { trackPageView } from '@utils/analytics';
import {
  SiteType,
  SiteStatus,
  SITE_TYPE_LABELS,
  SITE_STATUS_LABELS,
} from '@/types';
import type { Site, CachedAsset, LocalInspection } from '@/types';

// =============================================
// CONSTANTS
// =============================================

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

// =============================================
// SUB-COMPONENTS
// =============================================

function InfoRow({ label, value, icon }: { label: string; value: string | null | undefined; icon?: React.ReactNode }): JSX.Element | null {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2">
      {icon && <span className="text-iv-muted-2 mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        <p className="text-2xs text-iv-muted-2 uppercase tracking-wider">{label}</p>
        <p className="text-sm text-iv-text break-words">{value}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SiteStatus }): JSX.Element {
  const styles: Record<SiteStatus, string> = {
    [SiteStatus.ACTIVE]: 'bg-risk-low/15 text-risk-low',
    [SiteStatus.ARCHIVED]: 'bg-iv-muted-2/20 text-iv-muted-2',
    [SiteStatus.TEMPORARY_CLOSURE]: 'bg-risk-medium/15 text-risk-medium',
  };

  return (
    <span className={`iv-badge ${styles[status]}`}>
      {SITE_STATUS_LABELS[status]}
    </span>
  );
}

function SiteTypeIcon({ siteType }: { siteType: SiteType }): JSX.Element {
  switch (siteType) {
    case SiteType.PLAYGROUND:
    case SiteType.PARK:
    case SiteType.MIXED:
      return <TreePine className="w-5 h-5" />;
    case SiteType.OUTDOOR_GYM:
      return <Dumbbell className="w-5 h-5" />;
    default:
      return <LayoutGrid className="w-5 h-5" />;
  }
}

function FrequencyCard({
  label,
  days,
  lastDate,
}: {
  label: string;
  days: number;
  lastDate?: string | null;
}): JSX.Element {
  const isOverdue = lastDate
    ? Date.now() - new Date(lastDate).getTime() > days * 24 * 60 * 60 * 1000
    : false;

  return (
    <div className={`iv-panel p-3 ${isOverdue ? 'border-risk-high/50' : ''}`}>
      <p className="text-2xs text-iv-muted-2 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-lg font-semibold text-iv-text">
        Every {days} day{days !== 1 ? 's' : ''}
      </p>
      {isOverdue && (
        <p className="text-2xs text-risk-high font-medium mt-1">Overdue</p>
      )}
    </div>
  );
}

/** Embedded Mapbox mini-map with site pin */
function SiteLocationMap({ latitude, longitude }: { latitude: number; longitude: number }): JSX.Element {
  if (!MAPBOX_TOKEN) {
    return (
      <div>
        <p className="text-sm text-iv-muted">
          {latitude.toFixed(6)}, {longitude.toFixed(6)}
        </p>
        <p className="text-2xs text-iv-muted-2 mt-1">Map unavailable</p>
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-lg overflow-hidden border border-iv-border" style={{ height: 200 }}>
        <MapGL
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{ longitude, latitude, zoom: 15 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          attributionControl={false}
          interactive={true}
          scrollZoom={false}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <Marker longitude={longitude} latitude={latitude} anchor="center">
            <div className="w-8 h-8 rounded-full bg-iv-accent flex items-center justify-center shadow-lg ring-2 ring-white/30">
              <MapPin className="w-4 h-4 text-white" />
            </div>
          </Marker>
        </MapGL>
      </div>
      <p className="text-2xs text-iv-muted-2 mt-2">
        {latitude.toFixed(6)}, {longitude.toFixed(6)}
      </p>
    </div>
  );
}

// =============================================
// MAIN COMPONENT
// =============================================

export function SiteDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [site, setSite] = useState<Site | null>(null);
  const [assets, setAssets] = useState<CachedAsset[]>([]);
  const [siteInspections, setSiteInspections] = useState<LocalInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (id) trackPageView(`/sites/${id}`);
  }, [id]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    setDeleting(true);
    try {
      try {
        await secureFetch(`/api/v1/sites/${id}`, { method: 'DELETE' });
      } catch (err) {
        const is404 = err instanceof Error && err.message.includes('404');
        if (!is404) throw err;
      }
      await sitesCache.delete(id);
      void navigate('/sites');
    } catch (err) {
      captureError(err, { module: 'SiteDetail', operation: 'deleteSite' });
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    if (!id) {
      setError('No site ID provided.');
      setLoading(false);
      return;
    }

    async function loadSiteData(): Promise<void> {
      try {
        setLoading(true);
        setError(null);

        const [cachedSite, cachedAssets, cachedInspections] = await Promise.all([
          sitesCache.get(id as string),
          assetsCache.getBySite(id as string),
          inspectionsStore.getBySite(id as string),
        ]);

        if (!cachedSite) {
          setError('Site not found.');
          return;
        }

        setSite(cachedSite.data);
        setAssets(cachedAssets);
        setSiteInspections(cachedInspections);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load site';
        setError(message);
        captureError(err, { module: 'SiteDetail', operation: 'loadSiteData' });
      } finally {
        setLoading(false);
      }
    }

    void loadSiteData();
  }, [id]);

  // =========================================
  // LOADING / ERROR STATES
  // =========================================

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-iv-accent animate-spin" />
        <span className="ml-3 text-sm text-iv-muted">Loading site...</span>
      </div>
    );
  }

  if (error || !site) {
    return (
      <div className="iv-panel p-8 text-center">
        <AlertCircle className="w-8 h-8 text-risk-high mx-auto mb-3" />
        <p className="text-sm font-medium text-risk-high">{error ?? 'Site not found'}</p>
        <button type="button" className="iv-btn-secondary mt-4" onClick={() => void navigate('/sites')}>
          Back to Sites
        </button>
      </div>
    );
  }

  // =========================================
  // RENDER
  // =========================================

  return (
    <>
      <Helmet>
        <title>{site.name} — InspectVoice</title>
      </Helmet>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="iv-btn-icon mt-0.5"
            onClick={() => void navigate('/sites')}
            aria-label="Back to sites"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-iv-accent/10 flex items-center justify-center text-iv-accent">
                <SiteTypeIcon siteType={site.site_type} />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-iv-text">{site.name}</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm text-iv-muted">{SITE_TYPE_LABELS[site.site_type]}</span>
                  <StatusBadge status={site.status} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="iv-btn-icon text-risk-high hover:bg-risk-high/10"
            aria-label="Delete site"
            title="Delete site"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <Link to={`/sites/${site.id}/edit`} className="iv-btn-secondary">
            <Edit className="w-4 h-4" />
            <span className="hidden sm:inline">Edit</span>
          </Link>

          <Link to={`/inspections/new?siteId=${site.id}`} className="iv-btn-primary">
            <ClipboardCheck className="w-4 h-4" />
            <span className="hidden sm:inline">New Inspection</span>
          </Link>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-iv-surface border border-iv-border rounded-xl p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-risk-high/15 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-risk-high" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-iv-text">Delete Site</h3>
                <p className="text-2xs text-iv-muted mt-0.5">This cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-iv-muted mb-5">
              Are you sure you want to delete <strong className="text-iv-text">{site.name}</strong>? All associated data will be removed.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="iv-btn-secondary"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-risk-high text-white rounded-lg text-sm font-medium hover:bg-risk-high/90 disabled:opacity-50 transition-colors"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {deleting ? 'Deleting…' : 'Delete Site'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Site info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Details panel */}
          <div className="iv-panel p-5">
            <h2 className="text-sm font-semibold text-iv-text mb-3">Site Details</h2>

            <div className="space-y-1 divide-y divide-iv-border/50">
              <InfoRow label="Address" value={site.address} icon={<MapPin className="w-4 h-4" />} />
              <InfoRow label="Postcode" value={site.postcode} />
              {site.site_code && <InfoRow label="Site Code" value={site.site_code} />}
              {site.contact_name && <InfoRow label="Contact" value={site.contact_name} icon={<Info className="w-4 h-4" />} />}
              {site.contact_phone && <InfoRow label="Phone" value={site.contact_phone} icon={<Phone className="w-4 h-4" />} />}
              {site.contact_email && <InfoRow label="Email" value={site.contact_email} icon={<Mail className="w-4 h-4" />} />}
              {site.install_date && <InfoRow label="Installation Date" value={site.install_date} icon={<Calendar className="w-4 h-4" />} />}
              {site.access_notes && <InfoRow label="Access Notes" value={site.access_notes} />}
              {site.parking_notes && <InfoRow label="Parking" value={site.parking_notes} />}
              {site.notes && <InfoRow label="Notes" value={site.notes} />}
            </div>
          </div>

          {/* Asset Register */}
          <div className="iv-panel p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-iv-text flex items-center gap-2">
                <Package className="w-4 h-4 text-iv-accent" />
                Asset Register
                <span className="iv-badge bg-iv-surface-2 text-iv-muted ml-1">
                  {assets.length}
                </span>
              </h2>

              <Link to={`/sites/${site.id}/assets/new`} className="iv-btn-secondary text-sm">
                <Plus className="w-3.5 h-3.5" />
                Add Asset
              </Link>
            </div>

            {assets.length === 0 ? (
              <div className="text-center py-8">
                <Package className="w-8 h-8 text-iv-muted-2 mx-auto mb-3" />
                <p className="text-sm font-medium text-iv-text mb-1">No assets registered</p>
                <p className="text-sm text-iv-muted mb-4">
                  Add equipment to this site before starting inspections.
                </p>
                <Link to={`/sites/${site.id}/assets/new`} className="iv-btn-primary">
                  <Plus className="w-4 h-4" />
                  Add First Asset
                </Link>
              </div>
            ) : (
              <div className="space-y-1.5">
                {assets.map((cached) => {
                  const asset = cached.data;
                  return (
                    <Link
                      key={asset.id}
                      to={`/sites/${site.id}/assets/${asset.id}`}
                      className="iv-card-interactive flex items-center gap-3 py-2.5 px-3"
                    >
                      <div className="w-8 h-8 rounded-md bg-iv-surface-2 flex items-center justify-center shrink-0">
                        <Package className="w-4 h-4 text-iv-muted" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-iv-text truncate">
                          {asset.asset_code}
                        </p>
                        <p className="text-2xs text-iv-muted truncate">
                          {asset.asset_type} {asset.manufacturer ? `— ${asset.manufacturer}` : ''}
                        </p>
                      </div>
                      {asset.last_inspection_condition && (
                        <span className={`iv-badge text-2xs ${
                          asset.last_inspection_condition === 'good' ? 'bg-risk-low/15 text-risk-low' :
                          asset.last_inspection_condition === 'fair' ? 'bg-risk-medium/15 text-risk-medium' :
                          asset.last_inspection_condition === 'poor' ? 'bg-risk-high/15 text-risk-high' :
                          'bg-risk-very-high/15 text-risk-very-high'
                        }`}>
                          {asset.last_inspection_condition}
                        </span>
                      )}
                      <ChevronRight className="w-4 h-4 text-iv-muted-2 shrink-0" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Inspections */}
          <div className="iv-panel p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-iv-text flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-iv-accent" />
                Recent Inspections
                <span className="iv-badge bg-iv-surface-2 text-iv-muted ml-1">
                  {siteInspections.length}
                </span>
              </h2>
            </div>

            {siteInspections.length === 0 ? (
              <div className="text-center py-6">
                <ClipboardCheck className="w-8 h-8 text-iv-muted-2 mx-auto mb-3" />
                <p className="text-sm text-iv-muted">No inspections recorded for this site yet.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {siteInspections
                  .sort((a, b) => b.lastModified - a.lastModified)
                  .slice(0, 10)
                  .map((inspection) => (
                    <Link
                      key={inspection.id}
                      to={`/inspections/${inspection.id}`}
                      className="iv-card-interactive flex items-center gap-3 py-2.5 px-3"
                    >
                      <div className="w-8 h-8 rounded-md bg-iv-surface-2 flex items-center justify-center shrink-0">
                        <ClipboardCheck className="w-4 h-4 text-iv-muted" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-iv-text truncate">
                          {inspection.data.inspection_type} Inspection
                        </p>
                        <p className="text-2xs text-iv-muted">
                          {new Date(inspection.data.inspection_date).toLocaleDateString('en-GB')}
                        </p>
                      </div>
                      <span className={`iv-badge text-2xs ${
                        inspection.data.status === 'draft' ? 'bg-iv-surface-2 text-iv-muted' :
                        inspection.data.status === 'review' ? 'bg-risk-medium/15 text-risk-medium' :
                        inspection.data.status === 'signed' ? 'bg-risk-low/15 text-risk-low' :
                        'bg-iv-accent/15 text-iv-accent'
                      }`}>
                        {inspection.data.status}
                      </span>
                      <ChevronRight className="w-4 h-4 text-iv-muted-2 shrink-0" />
                    </Link>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — Inspection schedule */}
        <div className="space-y-6">
          <div className="iv-panel p-5">
            <h2 className="text-sm font-semibold text-iv-text mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-iv-accent" />
              Inspection Schedule
            </h2>

            <div className="space-y-3">
              <FrequencyCard
                label="Routine Visual"
                days={site.inspection_frequency_routine_days}
              />
              <FrequencyCard
                label="Operational"
                days={site.inspection_frequency_operational_days}
              />
              <FrequencyCard
                label="Annual Main"
                days={site.inspection_frequency_annual_days}
              />
            </div>
          </div>

          {/* Quick actions */}
          <div className="iv-panel p-5">
            <h2 className="text-sm font-semibold text-iv-text mb-3">Quick Actions</h2>

            <div className="space-y-2">
              <Link
                to={`/inspections/new?siteId=${site.id}&type=routine_visual`}
                className="iv-card-interactive flex items-center gap-3 py-2.5 px-3 w-full"
              >
                <ClipboardCheck className="w-4 h-4 text-iv-accent shrink-0" />
                <span className="text-sm text-iv-text">Start Routine Visual</span>
              </Link>
              <Link
                to={`/inspections/new?siteId=${site.id}&type=operational`}
                className="iv-card-interactive flex items-center gap-3 py-2.5 px-3 w-full"
              >
                <ClipboardCheck className="w-4 h-4 text-risk-medium shrink-0" />
                <span className="text-sm text-iv-text">Start Operational</span>
              </Link>
              <Link
                to={`/inspections/new?siteId=${site.id}&type=annual_main`}
                className="iv-card-interactive flex items-center gap-3 py-2.5 px-3 w-full"
              >
                <ClipboardCheck className="w-4 h-4 text-risk-high shrink-0" />
                <span className="text-sm text-iv-text">Start Annual Main</span>
              </Link>
            </div>
          </div>

          {/* Location — Mapbox mini-map */}
          {(site.latitude !== 0 || site.longitude !== 0) && (
            <div className="iv-panel p-5">
              <h2 className="text-sm font-semibold text-iv-text mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-iv-accent" />
                Location
              </h2>
              <SiteLocationMap latitude={site.latitude} longitude={site.longitude} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
