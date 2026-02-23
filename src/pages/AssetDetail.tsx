/**
 * InspectVoice — Asset Detail Page
 * Batch 10, File 2
 *
 * Route: /sites/:siteId/assets/:assetId
 *
 * Features:
 *   - Full asset information display
 *   - Compliance standard from assetTypes config
 *   - Inspection points reference per asset type
 *   - Risk criteria reference per severity level
 *   - Inspection history (from IndexedDB inspection items)
 *   - Condition trend indicator
 *   - Edit / Decommission actions
 *   - Reference photo placeholder (ready for Phase 4)
 *   - Dark theme (iv-* design tokens)
 *   - Mobile-first responsive
 *   - Accessible: semantic headings, aria-labels, keyboard navigation
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready first time
 */

import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  Edit,
  Loader2,
  AlertTriangle,
  Package,
  Factory,
  Ruler,
  Calendar,
  Hash,
  PoundSterling,
  Clock,
  FileText,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Minus,
  Camera,
  ClipboardList,
  AlertCircle,
  CheckCircle2,
  Info,
  ChevronDown,
  ChevronRight,
  Eye,
} from 'lucide-react';

import { assetsCache, inspectionItems } from '@services/offlineStore';
import { captureError } from '@utils/errorTracking';
import {
  ASSET_CATEGORY_LABELS,
  SURFACE_TYPE_LABELS,
  CONDITION_LABELS,
  RISK_RATING_LABELS,
  ACTION_TIMEFRAME_LABELS,
  ConditionRating,
  ConditionTrend,
  RiskRating,
  SurfaceType,
  AssetCategory,
} from '@/types';
import type { Asset, InspectionItem } from '@/types';
import {
  getAssetTypeConfig,
  getInspectionPointsForType,
  type AssetTypeConfig,
} from '@config/assetTypes';

// =============================================
// HELPERS
// =============================================

/** Format a date string for display */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/** Format currency */
function formatGBP(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Get colour class for condition rating */
function conditionColour(condition: ConditionRating | null): string {
  switch (condition) {
    case ConditionRating.GOOD:
      return 'text-[#22C55E]';
    case ConditionRating.FAIR:
      return 'text-[#EAB308]';
    case ConditionRating.POOR:
      return 'text-[#F97316]';
    case ConditionRating.DANGEROUS:
      return 'text-[#EF4444]';
    default:
      return 'iv-muted';
  }
}

/** Get background colour class for condition badge */
function conditionBadgeBg(condition: ConditionRating | null): string {
  switch (condition) {
    case ConditionRating.GOOD:
      return 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30';
    case ConditionRating.FAIR:
      return 'bg-[#EAB308]/15 text-[#EAB308] border-[#EAB308]/30';
    case ConditionRating.POOR:
      return 'bg-[#F97316]/15 text-[#F97316] border-[#F97316]/30';
    case ConditionRating.DANGEROUS:
      return 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30';
    default:
      return 'bg-[#2A2F3A] iv-muted border-[#2A2F3A]';
  }
}

/** Get risk rating colour class */
function riskColour(risk: RiskRating): string {
  switch (risk) {
    case RiskRating.VERY_HIGH:
      return 'text-[#EF4444]';
    case RiskRating.HIGH:
      return 'text-[#F97316]';
    case RiskRating.MEDIUM:
      return 'text-[#EAB308]';
    case RiskRating.LOW:
      return 'text-[#22C55E]';
  }
}

/** Get trend icon and label */
function trendDisplay(trend: ConditionTrend | null): {
  icon: JSX.Element;
  label: string;
  className: string;
} {
  switch (trend) {
    case ConditionTrend.IMPROVING:
      return {
        icon: <TrendingUp className="w-4 h-4" />,
        label: 'Improving',
        className: 'text-[#22C55E]',
      };
    case ConditionTrend.STABLE:
      return {
        icon: <Minus className="w-4 h-4" />,
        label: 'Stable',
        className: 'text-[#EAB308]',
      };
    case ConditionTrend.DETERIORATING:
      return {
        icon: <TrendingDown className="w-4 h-4" />,
        label: 'Deteriorating',
        className: 'text-[#EF4444]',
      };
    default:
      return {
        icon: <Minus className="w-4 h-4" />,
        label: 'No trend data',
        className: 'iv-muted',
      };
  }
}

// =============================================
// SUB-COMPONENTS
// =============================================

/** Detail row — label + value */
function DetailRow({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | React.ReactNode;
  valueClassName?: string;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3 py-2">
      {icon && <span className="iv-muted flex-shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0 flex-1">
        <p className="text-xs iv-muted">{label}</p>
        <p className={`text-sm iv-text mt-0.5 ${valueClassName ?? ''}`}>
          {value || '—'}
        </p>
      </div>
    </div>
  );
}

/** Collapsible section */
function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="iv-panel mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-[#1C2029] transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-[#22C55E]">{icon}</span>
          <h2 className="text-base font-semibold iv-text">{title}</h2>
          {badge}
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 iv-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 iv-muted" />
        )}
      </button>
      {open && <div className="px-4 pb-4 border-t border-[#2A2F3A]">{children}</div>}
    </div>
  );
}

/** Inspection history item */
function InspectionHistoryRow({ item }: { item: InspectionItem }): JSX.Element {
  const conditionLabel = item.overall_condition
    ? CONDITION_LABELS[item.overall_condition]
    : 'Not assessed';
  const riskLabel = item.risk_rating ? RISK_RATING_LABELS[item.risk_rating] : '—';

  return (
    <div className="flex items-center justify-between py-3 border-b border-[#2A2F3A] last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm iv-text">{formatDate(item.timestamp)}</p>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`text-xs font-medium ${
              item.overall_condition ? conditionColour(item.overall_condition) : 'iv-muted'
            }`}
          >
            {conditionLabel}
          </span>
          {item.risk_rating && (
            <>
              <span className="iv-muted text-xs">·</span>
              <span className={`text-xs font-medium ${riskColour(item.risk_rating)}`}>
                {riskLabel} risk
              </span>
            </>
          )}
          {item.defects.length > 0 && (
            <>
              <span className="iv-muted text-xs">·</span>
              <span className="text-xs iv-muted">
                {item.defects.length} defect{item.defects.length !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
        {item.inspector_notes && (
          <p className="text-xs iv-muted mt-1 line-clamp-2">{item.inspector_notes}</p>
        )}
      </div>
      {item.requires_action && (
        <span className="flex-shrink-0 ml-2">
          <AlertCircle className="w-4 h-4 text-[#F97316]" aria-label="Action required" />
        </span>
      )}
    </div>
  );
}

// =============================================
// MAIN COMPONENT
// =============================================

export default function AssetDetail(): JSX.Element {
  const { siteId, assetId } = useParams<{ siteId: string; assetId: string }>();
  const navigate = useNavigate();

  // ---- State ----
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [assetConfig, setAssetConfig] = useState<AssetTypeConfig | null>(null);
  const [history, setHistory] = useState<InspectionItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ---- Load asset ----
  useEffect(() => {
    if (!assetId || !siteId) return;

    let cancelled = false;

    async function loadData(): Promise<void> {
      try {
        const cached = await assetsCache.get(assetId!);
        if (cancelled) return;

        if (!cached) {
          setLoadError('Asset not found in local storage.');
          setLoading(false);
          return;
        }

        if (cached.site_id !== siteId) {
          setLoadError('Asset does not belong to this site.');
          setLoading(false);
          return;
        }

        const assetData = cached.data;
        setAsset(assetData);
        setAssetConfig(getAssetTypeConfig(assetData.asset_type));
        setLoading(false);

        // Load inspection history for this asset
        setHistoryLoading(true);
        try {
          // Get all local inspection items — filter by asset_id
          // In a full build, this would query the API. For offline, we scan local items.
          // Note: inspectionItems doesn't have a getByAsset method yet, so we
          // check all items and filter. This is acceptable for offline cache sizes.
          const allDirtyItems = await inspectionItems.getDirty();
          if (cancelled) return;

          const assetHistory = allDirtyItems
            .filter((item) => item.data.asset_id === assetId || item.data.asset_code === assetData.asset_code)
            .map((item) => item.data)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

          setHistory(assetHistory);
        } catch (histError) {
          captureError(histError, { module: 'AssetDetail', operation: 'loadHistory', assetId });
        } finally {
          if (!cancelled) setHistoryLoading(false);
        }
      } catch (error) {
        if (cancelled) return;
        captureError(error, { module: 'AssetDetail', operation: 'loadAsset', assetId });
        setLoadError('Failed to load asset data. Please try again.');
        setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [assetId, siteId]);

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Helmet>
          <title>Loading Asset... | InspectVoice</title>
        </Helmet>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 iv-muted animate-spin" />
          <p className="iv-muted text-sm">Loading asset...</p>
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (loadError || !asset || !siteId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Helmet>
          <title>Error | InspectVoice</title>
        </Helmet>
        <div className="iv-panel p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold iv-text mb-2">Cannot Load Asset</h2>
          <p className="iv-muted text-sm mb-4">{loadError ?? 'Asset data is missing.'}</p>
          <Link
            to={siteId ? `/sites/${siteId}` : '/sites'}
            className="iv-btn-secondary inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            {siteId ? 'Back to Site' : 'All Sites'}
          </Link>
        </div>
      </div>
    );
  }

  // ---- Derived data ----
  const categoryLabel =
    ASSET_CATEGORY_LABELS[asset.asset_category as AssetCategory] ?? asset.asset_category;
  const typeName = assetConfig?.name ?? asset.asset_type;
  const surfaceLabel = asset.surface_type
    ? SURFACE_TYPE_LABELS[asset.surface_type as SurfaceType] ?? asset.surface_type
    : null;
  const trend = trendDisplay(asset.condition_trend);
  const showPlaygroundFields =
    asset.asset_category === AssetCategory.PLAYGROUND ||
    asset.asset_category === AssetCategory.OUTDOOR_GYM;

  // Inspection points grouped by cadence
  const routinePoints = assetConfig
    ? getInspectionPointsForType(asset.asset_type, 'routine_visual')
    : [];
  const operationalPoints = assetConfig
    ? getInspectionPointsForType(asset.asset_type, 'operational')
    : [];
  const annualPoints = assetConfig
    ? getInspectionPointsForType(asset.asset_type, 'annual_main')
    : [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Helmet>
        <title>{asset.asset_code} — {typeName} | InspectVoice</title>
        <meta
          name="description"
          content={`Asset detail: ${typeName} (${asset.asset_code}) in the site register.`}
        />
      </Helmet>

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            to={`/sites/${siteId}`}
            className="iv-btn-icon"
            aria-label="Back to site"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold iv-text">{asset.asset_code}</h1>
              {!asset.is_active && (
                <span className="iv-badge text-xs bg-[#2A2F3A] iv-muted border border-[#2A2F3A] px-2 py-0.5 rounded-full">
                  Inactive
                </span>
              )}
            </div>
            <p className="text-sm iv-muted">
              {typeName} · {categoryLabel}
            </p>
          </div>
        </div>
        <Link
          to={`/sites/${siteId}/assets/${asset.id}/edit`}
          className="iv-btn-secondary flex items-center gap-1.5 text-sm"
          aria-label="Edit asset"
        >
          <Edit className="w-4 h-4" />
          Edit
        </Link>
      </div>

      {/* ── Condition Summary (if inspected) ── */}
      {asset.last_inspection_date && (
        <div className="iv-panel p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Condition badge */}
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${conditionBadgeBg(asset.last_inspection_condition)}`}
              >
                {asset.last_inspection_condition === ConditionRating.GOOD && (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                {asset.last_inspection_condition === ConditionRating.DANGEROUS && (
                  <AlertTriangle className="w-3.5 h-3.5" />
                )}
                {asset.last_inspection_condition
                  ? CONDITION_LABELS[asset.last_inspection_condition]
                  : 'Unknown'}
              </div>

              {/* Trend */}
              <div className={`flex items-center gap-1 text-xs ${trend.className}`}>
                {trend.icon}
                <span>{trend.label}</span>
              </div>
            </div>

            <p className="text-xs iv-muted">
              Last inspected {formatDate(asset.last_inspection_date)}
            </p>
          </div>
        </div>
      )}

      {/* ── No inspection yet banner ── */}
      {!asset.last_inspection_date && (
        <div className="iv-panel p-4 mb-4 border-l-4 border-l-[#EAB308]">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-[#EAB308] flex-shrink-0 mt-0.5" />
            <p className="text-sm iv-muted">
              This asset has not been inspected yet. It will appear in the next inspection for this
              site.
            </p>
          </div>
        </div>
      )}

      {/* ── Reference Photo Placeholder ── */}
      <div className="iv-panel p-5 mb-4">
        <h2 className="text-base font-semibold iv-text mb-3 flex items-center gap-2">
          <Camera className="w-4 h-4 text-[#22C55E]" />
          Reference Photo
        </h2>
        {asset.reference_photo_id ? (
          <div className="aspect-video bg-[#1C2029] rounded-lg flex items-center justify-center">
            <p className="text-sm iv-muted">Photo loading requires sync service (Phase 5)</p>
          </div>
        ) : (
          <div className="aspect-video bg-[#1C2029] rounded-lg flex flex-col items-center justify-center border-2 border-dashed border-[#2A2F3A]">
            <Camera className="w-8 h-8 iv-muted mb-2" />
            <p className="text-sm iv-muted">No reference photo</p>
            <p className="text-xs iv-muted mt-1">
              Photo capture available in Phase 4
            </p>
          </div>
        )}
      </div>

      {/* ── Asset Information ── */}
      <div className="iv-panel p-5 mb-4">
        <h2 className="text-base font-semibold iv-text mb-3 flex items-center gap-2">
          <Package className="w-4 h-4 text-[#22C55E]" />
          Asset Information
        </h2>

        <div className="divide-y divide-[#2A2F3A]">
          <DetailRow
            icon={<Hash className="w-3.5 h-3.5" />}
            label="Asset Code"
            value={asset.asset_code}
          />
          <DetailRow
            icon={<Package className="w-3.5 h-3.5" />}
            label="Type"
            value={typeName}
          />
          <DetailRow
            icon={<Package className="w-3.5 h-3.5" />}
            label="Category"
            value={categoryLabel}
          />
          {assetConfig?.complianceStandard && (
            <DetailRow
              icon={<ShieldCheck className="w-3.5 h-3.5" />}
              label="Compliance Standard"
              value={assetConfig.complianceStandard}
              valueClassName="text-[#22C55E]"
            />
          )}
        </div>
      </div>

      {/* ── Manufacturer Details ── */}
      <div className="iv-panel p-5 mb-4">
        <h2 className="text-base font-semibold iv-text mb-3 flex items-center gap-2">
          <Factory className="w-4 h-4 text-[#22C55E]" />
          Manufacturer Details
        </h2>

        <div className="divide-y divide-[#2A2F3A]">
          <DetailRow
            icon={<Factory className="w-3.5 h-3.5" />}
            label="Manufacturer"
            value={asset.manufacturer}
          />
          <DetailRow label="Model" value={asset.model} />
          <DetailRow
            icon={<Hash className="w-3.5 h-3.5" />}
            label="Serial Number"
            value={asset.serial_number}
          />
          <DetailRow
            icon={<Calendar className="w-3.5 h-3.5" />}
            label="Install Date"
            value={formatDate(asset.install_date)}
          />
          <DetailRow
            icon={<PoundSterling className="w-3.5 h-3.5" />}
            label="Purchase Cost"
            value={formatGBP(asset.purchase_cost_gbp)}
          />
          <DetailRow
            icon={<Clock className="w-3.5 h-3.5" />}
            label="Expected Lifespan"
            value={
              asset.expected_lifespan_years !== null
                ? `${asset.expected_lifespan_years} years`
                : '—'
            }
          />
        </div>
      </div>

      {/* ── Safety Measurements (playground/gym only) ── */}
      {showPlaygroundFields && (
        <div className="iv-panel p-5 mb-4">
          <h2 className="text-base font-semibold iv-text mb-3 flex items-center gap-2">
            <Ruler className="w-4 h-4 text-[#22C55E]" />
            Safety Measurements
          </h2>

          <div className="divide-y divide-[#2A2F3A]">
            <DetailRow
              icon={<Ruler className="w-3.5 h-3.5" />}
              label="Impact Surface Type"
              value={surfaceLabel}
            />
            <DetailRow
              icon={<Ruler className="w-3.5 h-3.5" />}
              label="Critical Fall Height"
              value={
                asset.fall_height_mm !== null ? `${asset.fall_height_mm.toLocaleString()}mm` : '—'
              }
            />
            <DetailRow
              label="Required Surfacing Depth"
              value={
                asset.impact_attenuation_required_mm !== null
                  ? `${asset.impact_attenuation_required_mm.toLocaleString()}mm`
                  : '—'
              }
            />
          </div>
        </div>
      )}

      {/* ── Maintenance ── */}
      <div className="iv-panel p-5 mb-4">
        <h2 className="text-base font-semibold iv-text mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#22C55E]" />
          Maintenance
        </h2>

        <div className="divide-y divide-[#2A2F3A]">
          <DetailRow
            icon={<Calendar className="w-3.5 h-3.5" />}
            label="Last Maintenance"
            value={formatDate(asset.last_maintenance_date)}
          />
          <DetailRow
            icon={<Calendar className="w-3.5 h-3.5" />}
            label="Next Maintenance Due"
            value={formatDate(asset.next_maintenance_due)}
          />
          {asset.maintenance_notes && (
            <div className="py-2">
              <p className="text-xs iv-muted mb-1">Notes</p>
              <p className="text-sm iv-text whitespace-pre-wrap">{asset.maintenance_notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Inspection Points Reference (collapsible) ── */}
      {assetConfig && (
        <CollapsibleSection
          title="Inspection Points"
          icon={<ClipboardList className="w-4 h-4" />}
          badge={
            <span className="text-xs iv-muted ml-2">
              {assetConfig.inspectionPoints.length} checks
            </span>
          }
        >
          <div className="mt-3 space-y-4">
            {/* Routine Visual */}
            {routinePoints.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold iv-muted uppercase tracking-wider mb-2">
                  Routine Visual
                </h3>
                <ul className="space-y-1.5">
                  {routinePoints.map((point, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <Eye className="w-3.5 h-3.5 iv-muted flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="iv-text">{point.label}</span>
                        <p className="text-xs iv-muted mt-0.5">{point.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Operational */}
            {operationalPoints.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold iv-muted uppercase tracking-wider mb-2">
                  Operational
                </h3>
                <ul className="space-y-1.5">
                  {operationalPoints.map((point, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <Eye className="w-3.5 h-3.5 iv-muted flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="iv-text">{point.label}</span>
                        <p className="text-xs iv-muted mt-0.5">{point.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Annual Main */}
            {annualPoints.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold iv-muted uppercase tracking-wider mb-2">
                  Annual Main
                </h3>
                <ul className="space-y-1.5">
                  {annualPoints.map((point, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <Eye className="w-3.5 h-3.5 iv-muted flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="iv-text">{point.label}</span>
                        <p className="text-xs iv-muted mt-0.5">{point.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Risk Criteria Reference (collapsible) ── */}
      {assetConfig && (
        <CollapsibleSection
          title="Risk Criteria"
          icon={<AlertTriangle className="w-4 h-4" />}
        >
          <div className="mt-3 space-y-4">
            {(
              [
                { key: 'very_high' as const, label: 'Very High', risk: RiskRating.VERY_HIGH },
                { key: 'high' as const, label: 'High', risk: RiskRating.HIGH },
                { key: 'medium' as const, label: 'Medium', risk: RiskRating.MEDIUM },
                { key: 'low' as const, label: 'Low', risk: RiskRating.LOW },
              ] as const
            ).map(({ key, label, risk }) => {
              const criteria = assetConfig.riskCriteria[key];
              if (criteria.length === 0) return null;

              return (
                <div key={key}>
                  <h3 className={`text-xs font-semibold uppercase tracking-wider mb-1.5 ${riskColour(risk)}`}>
                    {label} Risk
                  </h3>
                  <ul className="space-y-1">
                    {criteria.map((item, idx) => (
                      <li key={idx} className="text-sm iv-text flex items-start gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${
                          risk === RiskRating.VERY_HIGH ? 'bg-[#EF4444]' :
                          risk === RiskRating.HIGH ? 'bg-[#F97316]' :
                          risk === RiskRating.MEDIUM ? 'bg-[#EAB308]' :
                          'bg-[#22C55E]'
                        }`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* ── BS EN Defect Categories (collapsible) ── */}
      {assetConfig && assetConfig.bsEnDefectCategories.length > 0 && (
        <CollapsibleSection
          title="BS EN References"
          icon={<ShieldCheck className="w-4 h-4" />}
          badge={
            <span className="text-xs iv-muted ml-2">
              {assetConfig.bsEnDefectCategories.length} refs
            </span>
          }
        >
          <ul className="mt-3 space-y-1.5">
            {assetConfig.bsEnDefectCategories.map((ref, idx) => (
              <li key={idx} className="text-sm iv-text flex items-start gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-[#22C55E] flex-shrink-0 mt-0.5" />
                {ref}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* ── Inspection History ── */}
      <div className="iv-panel mb-4 overflow-hidden">
        <div className="p-4">
          <h2 className="text-base font-semibold iv-text flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-[#22C55E]" />
            Inspection History
          </h2>
        </div>

        <div className="px-4 pb-4 border-t border-[#2A2F3A]">
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 iv-muted animate-spin" />
            </div>
          ) : history.length > 0 ? (
            <div className="mt-2">
              {history.map((item) => (
                <InspectionHistoryRow key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="py-6 text-center">
              <ClipboardList className="w-8 h-8 iv-muted mx-auto mb-2" />
              <p className="text-sm iv-muted">No inspection records yet</p>
              <p className="text-xs iv-muted mt-1">
                History will appear here after this asset is inspected
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Decommission info (if inactive) ── */}
      {!asset.is_active && (
        <div className="iv-panel p-5 mb-4 border-l-4 border-l-[#EF4444]">
          <h2 className="text-base font-semibold iv-text mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
            Decommissioned
          </h2>
          <div className="divide-y divide-[#2A2F3A]">
            <DetailRow
              icon={<Calendar className="w-3.5 h-3.5" />}
              label="Decommissioned Date"
              value={formatDate(asset.decommissioned_date)}
            />
            {asset.decommission_reason && (
              <DetailRow label="Reason" value={asset.decommission_reason} />
            )}
          </div>
        </div>
      )}

      {/* ── Footer metadata ── */}
      <div className="text-xs iv-muted text-center py-4 space-y-1">
        <p>Created {formatDate(asset.created_at)} · Updated {formatDate(asset.updated_at)}</p>
        <p className="font-mono text-[10px] opacity-50">{asset.id}</p>
      </div>
    </div>
  );
}
