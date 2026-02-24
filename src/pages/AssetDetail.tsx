/**
 * InspectVoice — Asset Detail Page
 * Route: /sites/:siteId/assets/:assetId
 *
 * Features:
 *   - Full asset information display
 *   - Compliance standard from assetTypes config
 *   - Inspection points reference per asset type
 *   - Risk criteria reference per severity level
 *   - CONDITION TIMELINE: SVG chart of condition ratings over time (Feature 2)
 *   - API-FETCHED inspection history with condition + defect counts (Feature 2)
 *   - DEFECT HISTORY: all defects ever raised against this asset (Feature 2)
 *   - REPEAT DEFECT DETECTION: flags recurring BS EN references (Feature 2)
 *   - Condition trend indicator
 *   - Edit / Decommission actions
 *   - Reference photo placeholder (ready for Phase 4)
 *   - Dark theme (iv-* design tokens)
 *   - Mobile-first responsive
 *   - Accessible: semantic headings, aria-labels, keyboard navigation
 *
 * API: GET /api/v1/assets/:id/history
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
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
  RefreshCw,
  Repeat,
  ExternalLink,
} from 'lucide-react';

import { assetsCache } from '@services/offlineStore';
import { captureError } from '@utils/errorTracking';
import { useFetch } from '@hooks/useFetch';
import {
  ASSET_CATEGORY_LABELS,
  SURFACE_TYPE_LABELS,
  RISK_RATING_LABELS,
  ConditionRating,
  ConditionTrend,
  RiskRating,
  SurfaceType,
  AssetCategory,
} from '@/types';
import type { Asset } from '@/types';
import {
  getAssetTypeConfig,
  getInspectionPointsForType,
  type AssetTypeConfig,
} from '@config/assetTypes';

// =============================================
// TYPES — Asset History API Response
// =============================================

interface AssetHistoryResponse {
  success: boolean;
  data: {
    asset_id: string;
    inspection_history: InspectionHistoryItem[];
    defect_history: DefectHistoryItem[];
    condition_timeline: ConditionPoint[];
    condition_summary: ConditionSummary;
  };
}

interface InspectionHistoryItem {
  inspection_id: string;
  inspection_date: string;
  inspection_type: string;
  inspector_name: string;
  overall_condition: ConditionRating | null;
  risk_rating: RiskRating | null;
  defect_count: number;
  inspector_notes: string | null;
  site_name: string;
}

interface DefectHistoryItem {
  id: string;
  description: string;
  severity: string;
  status: string;
  bs_en_reference: string | null;
  action_timeframe: string;
  remedial_action: string;
  due_date: string | null;
  created_at: string;
  resolved_at: string | null;
  inspection_id: string;
  inspection_date: string;
  made_safe: boolean;
  made_safe_at: string | null;
}

interface ConditionPoint {
  inspection_date: string;
  overall_condition: string;
  risk_rating: string | null;
}

interface RepeatDefect {
  bs_en_reference: string;
  occurrence_count: number;
  last_seen: string;
  severities: string;
}

interface ConditionSummary {
  total_inspections: number;
  first_inspected: string | null;
  last_inspected: string | null;
  current_condition: string | null;
  condition_trend: 'improving' | 'stable' | 'deteriorating' | null;
  total_defects: number;
  open_defects: number;
  resolved_defects: number;
  repeat_defect_types: RepeatDefect[];
}

// =============================================
// HELPERS
// =============================================

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

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function formatGBP(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function conditionColour(condition: ConditionRating | string | null): string {
  switch (condition) {
    case ConditionRating.GOOD:
    case 'good':
      return 'text-[#22C55E]';
    case ConditionRating.FAIR:
    case 'fair':
      return 'text-[#EAB308]';
    case ConditionRating.POOR:
    case 'poor':
      return 'text-[#F97316]';
    case ConditionRating.DANGEROUS:
    case 'dangerous':
      return 'text-[#EF4444]';
    default:
      return 'iv-muted';
  }
}

function conditionBadgeBg(condition: ConditionRating | string | null): string {
  switch (condition) {
    case ConditionRating.GOOD:
    case 'good':
      return 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30';
    case ConditionRating.FAIR:
    case 'fair':
      return 'bg-[#EAB308]/15 text-[#EAB308] border-[#EAB308]/30';
    case ConditionRating.POOR:
    case 'poor':
      return 'bg-[#F97316]/15 text-[#F97316] border-[#F97316]/30';
    case ConditionRating.DANGEROUS:
    case 'dangerous':
      return 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30';
    default:
      return 'bg-[#2A2F3A] iv-muted border-[#2A2F3A]';
  }
}

function conditionHexColour(condition: string): string {
  switch (condition) {
    case 'good': return '#22C55E';
    case 'fair': return '#EAB308';
    case 'poor': return '#F97316';
    case 'dangerous': return '#EF4444';
    default: return '#6B7280';
  }
}

function conditionLabel(condition: string | null): string {
  if (!condition) return 'Unknown';
  const map: Record<string, string> = {
    good: 'Good',
    fair: 'Fair',
    poor: 'Poor',
    dangerous: 'Dangerous',
  };
  return map[condition] ?? condition;
}

function riskColour(risk: RiskRating | string): string {
  switch (risk) {
    case RiskRating.VERY_HIGH:
    case 'very_high':
      return 'text-[#EF4444]';
    case RiskRating.HIGH:
    case 'high':
      return 'text-[#F97316]';
    case RiskRating.MEDIUM:
    case 'medium':
      return 'text-[#EAB308]';
    case RiskRating.LOW:
    case 'low':
      return 'text-[#22C55E]';
    default:
      return 'iv-muted';
  }
}

function severityBadgeBg(severity: string): string {
  switch (severity) {
    case 'very_high': return 'bg-[#EF4444]/15 text-[#EF4444]';
    case 'high': return 'bg-[#F97316]/15 text-[#F97316]';
    case 'medium': return 'bg-[#EAB308]/15 text-[#EAB308]';
    case 'low': return 'bg-[#22C55E]/15 text-[#22C55E]';
    default: return 'bg-[#2A2F3A] iv-muted';
  }
}

function trendDisplay(trend: ConditionTrend | string | null): {
  icon: JSX.Element;
  label: string;
  className: string;
} {
  switch (trend) {
    case ConditionTrend.IMPROVING:
    case 'improving':
      return { icon: <TrendingUp className="w-4 h-4" />, label: 'Improving', className: 'text-[#22C55E]' };
    case ConditionTrend.STABLE:
    case 'stable':
      return { icon: <Minus className="w-4 h-4" />, label: 'Stable', className: 'text-[#EAB308]' };
    case ConditionTrend.DETERIORATING:
    case 'deteriorating':
      return { icon: <TrendingDown className="w-4 h-4" />, label: 'Deteriorating', className: 'text-[#EF4444]' };
    default:
      return { icon: <Minus className="w-4 h-4" />, label: 'No trend data', className: 'iv-muted' };
  }
}

const INSPECTION_TYPE_LABELS: Record<string, string> = {
  routine_visual: 'Routine Visual',
  operational: 'Operational',
  annual_main: 'Annual Main',
};

const DEFECT_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  verified: 'Verified',
  deferred: 'Deferred',
};

const DEFECT_STATUS_STYLES: Record<string, string> = {
  open: 'bg-[#EF4444]/15 text-[#EF4444]',
  in_progress: 'bg-[#EAB308]/15 text-[#EAB308]',
  resolved: 'bg-[#22C55E]/15 text-[#22C55E]',
  verified: 'bg-[#22C55E]/15 text-[#22C55E]',
  deferred: 'bg-[#6B7280]/15 text-[#6B7280]',
};

// =============================================
// SUB-COMPONENTS
// =============================================

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

// =============================================
// CONDITION TIMELINE CHART (Feature 2)
// =============================================

const CONDITION_VALUES: Record<string, number> = {
  good: 4,
  fair: 3,
  poor: 2,
  dangerous: 1,
};

function ConditionTimelineChart({ points }: { points: ConditionPoint[] }): JSX.Element {
  const chartData = useMemo(() => {
    if (points.length === 0) return null;

    const width = 320;
    const height = 120;
    const padX = 32;
    const padTop = 16;
    const padBottom = 24;
    const plotW = width - padX * 2;
    const plotH = height - padTop - padBottom;

    // Map condition to Y (4=top, 1=bottom)
    const toY = (val: number): number => padTop + plotH - ((val - 1) / 3) * plotH;

    // Distribute points evenly across X if only one date or same date
    const toX = (idx: number): number => {
      if (points.length === 1) return padX + plotW / 2;
      return padX + (idx / (points.length - 1)) * plotW;
    };

    const mapped = points.map((p, i) => ({
      x: toX(i),
      y: toY(CONDITION_VALUES[p.overall_condition] ?? 2),
      condition: p.overall_condition,
      date: p.inspection_date,
      risk: p.risk_rating,
    }));

    // Build polyline path
    const pathD = mapped.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    // Y-axis labels
    const yLabels = [
      { label: 'Good', y: toY(4), colour: '#22C55E' },
      { label: 'Fair', y: toY(3), colour: '#EAB308' },
      { label: 'Poor', y: toY(2), colour: '#F97316' },
      { label: 'Dang.', y: toY(1), colour: '#EF4444' },
    ];

    return { width, height, mapped, pathD, yLabels, padX, plotW, padTop, padBottom, plotH };
  }, [points]);

  if (!chartData || points.length < 2) {
    return (
      <div className="flex items-center justify-center py-6">
        <p className="text-xs iv-muted">
          {points.length === 0
            ? 'No condition data recorded yet'
            : 'Need at least 2 inspections to show trend'}
        </p>
      </div>
    );
  }

  const { width, height, mapped, pathD, yLabels, padX, plotW } = chartData;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label="Asset condition trend over time"
    >
      {/* Horizontal grid lines */}
      {yLabels.map((yl) => (
        <g key={yl.label}>
          <line
            x1={padX}
            y1={yl.y}
            x2={padX + plotW}
            y2={yl.y}
            stroke="#2A2F3A"
            strokeWidth="1"
          />
          <text
            x={padX - 4}
            y={yl.y + 3}
            textAnchor="end"
            fill={yl.colour}
            fontSize="8"
            fontFamily="system-ui"
          >
            {yl.label}
          </text>
        </g>
      ))}

      {/* Trend line */}
      <path
        d={pathD}
        fill="none"
        stroke="#22C55E"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />

      {/* Data points */}
      {mapped.map((p, i) => (
        <g key={i}>
          <circle
            cx={p.x}
            cy={p.y}
            r="4"
            fill={conditionHexColour(p.condition)}
            stroke="#0F1117"
            strokeWidth="2"
          />
          {/* Date label (show first, last, and middle-ish) */}
          {(i === 0 || i === mapped.length - 1 || (mapped.length > 4 && i === Math.floor(mapped.length / 2))) && (
            <text
              x={p.x}
              y={height - 4}
              textAnchor="middle"
              fill="#6B7280"
              fontSize="7"
              fontFamily="system-ui"
            >
              {formatShortDate(p.date)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

// =============================================
// REPEAT DEFECT ALERT (Feature 2)
// =============================================

function RepeatDefectAlert({ repeats }: { repeats: RepeatDefect[] }): JSX.Element | null {
  if (repeats.length === 0) return null;

  return (
    <div className="iv-panel p-4 mb-4 border-l-4 border-l-[#F97316]">
      <div className="flex items-center gap-2 mb-3">
        <Repeat className="w-4 h-4 text-[#F97316]" />
        <h2 className="text-sm font-semibold iv-text">Repeat Issues Detected</h2>
        <span className="text-xs bg-[#F97316]/15 text-[#F97316] px-2 py-0.5 rounded-full font-medium">
          {repeats.length}
        </span>
      </div>
      <p className="text-xs iv-muted mb-3">
        These BS EN references have been flagged multiple times on this asset — may indicate
        a systemic problem requiring capital intervention.
      </p>
      <div className="space-y-2">
        {repeats.map((r) => (
          <div
            key={r.bs_en_reference}
            className="flex items-center justify-between p-2.5 rounded-lg bg-[#1C2029]"
          >
            <div className="min-w-0 flex-1">
              <span className="text-sm font-mono text-[#F97316]">{r.bs_en_reference}</span>
              <p className="text-xs iv-muted mt-0.5">
                Last seen {formatDate(r.last_seen)} · Severities: {r.severities}
              </p>
            </div>
            <span className="text-sm font-bold text-[#F97316] shrink-0 ml-3">
              ×{r.occurrence_count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================
// HISTORY STATS SUMMARY (Feature 2)
// =============================================

function HistoryStatsSummary({ summary }: { summary: ConditionSummary }): JSX.Element {
  const trend = trendDisplay(summary.condition_trend);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div className="iv-panel p-3 text-center">
        <p className="text-lg font-bold iv-text">{summary.total_inspections}</p>
        <p className="text-2xs iv-muted">Inspections</p>
      </div>
      <div className="iv-panel p-3 text-center">
        <p className={`text-lg font-bold ${conditionColour(summary.current_condition)}`}>
          {conditionLabel(summary.current_condition)}
        </p>
        <p className="text-2xs iv-muted">Current</p>
      </div>
      <div className="iv-panel p-3 text-center">
        <div className={`flex items-center justify-center gap-1 ${trend.className}`}>
          {trend.icon}
          <p className="text-sm font-bold">{trend.label}</p>
        </div>
        <p className="text-2xs iv-muted">Trend</p>
      </div>
      <div className="iv-panel p-3 text-center">
        <p className={`text-lg font-bold ${summary.open_defects > 0 ? 'text-[#F97316]' : 'text-[#22C55E]'}`}>
          {summary.open_defects}
        </p>
        <p className="text-2xs iv-muted">Open Defects</p>
      </div>
    </div>
  );
}

// =============================================
// MAIN COMPONENT
// =============================================

export default function AssetDetail(): JSX.Element {
  const { siteId, assetId } = useParams<{ siteId: string; assetId: string }>();

  // ---- State: local asset data ----
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [assetConfig, setAssetConfig] = useState<AssetTypeConfig | null>(null);

  // ---- State: API history ----
  const {
    data: historyData,
    loading: historyLoading,
    error: historyError,
    refetch: refetchHistory,
  } = useFetch<AssetHistoryResponse>(
    assetId ? `/api/v1/assets/${assetId}/history` : '',
  );

  const historyPayload = historyData?.data ?? null;
  const inspectionHistory = historyPayload?.inspection_history ?? [];
  const defectHistory = historyPayload?.defect_history ?? [];
  const conditionTimeline = historyPayload?.condition_timeline ?? [];
  const conditionSummary = historyPayload?.condition_summary ?? null;
  const repeatDefects = conditionSummary?.repeat_defect_types ?? [];

  // ---- Load local asset ----
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
      } catch (error) {
        if (cancelled) return;
        captureError(error, { module: 'AssetDetail', operation: 'loadAsset' });
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

  // Use API trend if available, fall back to local asset trend
  const effectiveTrend = conditionSummary?.condition_trend ?? asset.condition_trend;
  const trend = trendDisplay(effectiveTrend);

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

      {/* ── Condition Summary (uses API data if available) ── */}
      {(asset.last_inspection_date || conditionSummary?.last_inspected) && (
        <div className="iv-panel p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${conditionBadgeBg(
                  conditionSummary?.current_condition ?? asset.last_inspection_condition,
                )}`}
              >
                {(conditionSummary?.current_condition ?? asset.last_inspection_condition) === 'good' && (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                {(conditionSummary?.current_condition ?? asset.last_inspection_condition) === 'dangerous' && (
                  <AlertTriangle className="w-3.5 h-3.5" />
                )}
                {conditionLabel(conditionSummary?.current_condition ?? asset.last_inspection_condition)}
              </div>

              <div className={`flex items-center gap-1 text-xs ${trend.className}`}>
                {trend.icon}
                <span>{trend.label}</span>
              </div>
            </div>

            <p className="text-xs iv-muted">
              Last inspected {formatDate(conditionSummary?.last_inspected ?? asset.last_inspection_date)}
            </p>
          </div>
        </div>
      )}

      {/* ── No inspection yet banner ── */}
      {!asset.last_inspection_date && !conditionSummary?.last_inspected && (
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

      {/* ══════════════════════════════════════════ */}
      {/* FEATURE 2: Longitudinal History Section   */}
      {/* ══════════════════════════════════════════ */}

      {/* History stats summary */}
      {conditionSummary && conditionSummary.total_inspections > 0 && (
        <HistoryStatsSummary summary={conditionSummary} />
      )}

      {/* Condition Timeline Chart */}
      {conditionTimeline.length > 0 && (
        <div className="iv-panel p-4 mb-4">
          <h2 className="text-base font-semibold iv-text mb-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#22C55E]" />
            Condition Over Time
          </h2>
          <ConditionTimelineChart points={conditionTimeline} />
          <p className="text-2xs iv-muted mt-2 text-center">
            {conditionTimeline.length} inspection{conditionTimeline.length !== 1 ? 's' : ''} from{' '}
            {formatShortDate(conditionTimeline[0]!.inspection_date)} to{' '}
            {formatShortDate(conditionTimeline[conditionTimeline.length - 1]!.inspection_date)}
          </p>
        </div>
      )}

      {/* Repeat Defect Alert */}
      <RepeatDefectAlert repeats={repeatDefects} />

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
            <p className="text-xs iv-muted mt-1">Photo capture available in Phase 4</p>
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
          <DetailRow icon={<Hash className="w-3.5 h-3.5" />} label="Asset Code" value={asset.asset_code} />
          <DetailRow icon={<Package className="w-3.5 h-3.5" />} label="Type" value={typeName} />
          <DetailRow icon={<Package className="w-3.5 h-3.5" />} label="Category" value={categoryLabel} />
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
          <DetailRow icon={<Factory className="w-3.5 h-3.5" />} label="Manufacturer" value={asset.manufacturer} />
          <DetailRow label="Model" value={asset.model} />
          <DetailRow icon={<Hash className="w-3.5 h-3.5" />} label="Serial Number" value={asset.serial_number} />
          <DetailRow icon={<Calendar className="w-3.5 h-3.5" />} label="Install Date" value={formatDate(asset.install_date)} />
          <DetailRow icon={<PoundSterling className="w-3.5 h-3.5" />} label="Purchase Cost" value={formatGBP(asset.purchase_cost_gbp)} />
          <DetailRow
            icon={<Clock className="w-3.5 h-3.5" />}
            label="Expected Lifespan"
            value={asset.expected_lifespan_years !== null ? `${asset.expected_lifespan_years} years` : '—'}
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
            <DetailRow icon={<Ruler className="w-3.5 h-3.5" />} label="Impact Surface Type" value={surfaceLabel} />
            <DetailRow
              icon={<Ruler className="w-3.5 h-3.5" />}
              label="Critical Fall Height"
              value={asset.fall_height_mm !== null ? `${asset.fall_height_mm.toLocaleString()}mm` : '—'}
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
          <DetailRow icon={<Calendar className="w-3.5 h-3.5" />} label="Last Maintenance" value={formatDate(asset.last_maintenance_date)} />
          <DetailRow icon={<Calendar className="w-3.5 h-3.5" />} label="Next Maintenance Due" value={formatDate(asset.next_maintenance_due)} />
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
            {routinePoints.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold iv-muted uppercase tracking-wider mb-2">Routine Visual</h3>
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
            {operationalPoints.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold iv-muted uppercase tracking-wider mb-2">Operational</h3>
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
            {annualPoints.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold iv-muted uppercase tracking-wider mb-2">Annual Main</h3>
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

      {/* ══════════════════════════════════════════ */}
      {/* INSPECTION HISTORY — API-fetched (F2)     */}
      {/* ══════════════════════════════════════════ */}

      <div className="iv-panel mb-4 overflow-hidden">
        <div className="p-4 flex items-center justify-between">
          <h2 className="text-base font-semibold iv-text flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-[#22C55E]" />
            Inspection History
            {inspectionHistory.length > 0 && (
              <span className="text-xs iv-muted font-normal ml-1">
                ({inspectionHistory.length})
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={refetchHistory}
            disabled={historyLoading}
            className="iv-btn-icon"
            aria-label="Refresh history"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="px-4 pb-4 border-t border-[#2A2F3A]">
          {historyLoading && inspectionHistory.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 iv-muted animate-spin" />
            </div>
          ) : historyError ? (
            <div className="py-6 text-center">
              <AlertCircle className="w-6 h-6 text-[#F97316] mx-auto mb-2" />
              <p className="text-sm iv-muted">Failed to load history</p>
              <button
                type="button"
                onClick={refetchHistory}
                className="text-xs text-[#22C55E] mt-2 hover:underline"
              >
                Retry
              </button>
            </div>
          ) : inspectionHistory.length > 0 ? (
            <div className="mt-2 space-y-0">
              {inspectionHistory.map((item) => {
                const condLabel = item.overall_condition
                  ? conditionLabel(item.overall_condition)
                  : 'Not assessed';
                const riskLabel = item.risk_rating
                  ? RISK_RATING_LABELS[item.risk_rating] ?? item.risk_rating
                  : null;
                const typeLabel = INSPECTION_TYPE_LABELS[item.inspection_type] ?? item.inspection_type;

                return (
                  <div
                    key={item.inspection_id}
                    className="flex items-center justify-between py-3 border-b border-[#2A2F3A] last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm iv-text">{formatDate(item.inspection_date)}</p>
                        <span className="text-2xs iv-muted">{typeLabel}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={`text-xs font-medium ${
                            item.overall_condition ? conditionColour(item.overall_condition) : 'iv-muted'
                          }`}
                        >
                          {condLabel}
                        </span>
                        {riskLabel && (
                          <>
                            <span className="iv-muted text-xs">·</span>
                            <span className={`text-xs font-medium ${riskColour(item.risk_rating!)}`}>
                              {riskLabel} risk
                            </span>
                          </>
                        )}
                        {item.defect_count > 0 && (
                          <>
                            <span className="iv-muted text-xs">·</span>
                            <span className="text-xs iv-muted">
                              {item.defect_count} defect{item.defect_count !== 1 ? 's' : ''}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-2xs iv-muted mt-0.5">{item.inspector_name}</p>
                      {item.inspector_notes && (
                        <p className="text-xs iv-muted mt-1 line-clamp-2">{item.inspector_notes}</p>
                      )}
                    </div>

                    <Link
                      to={`/sites/${siteId}/inspections/${item.inspection_id}/review`}
                      className="iv-btn-icon shrink-0 ml-2"
                      title="View inspection"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                );
              })}
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

      {/* ══════════════════════════════════════════ */}
      {/* DEFECT HISTORY — API-fetched (Feature 2)  */}
      {/* ══════════════════════════════════════════ */}

      {defectHistory.length > 0 && (
        <CollapsibleSection
          title="Defect History"
          icon={<AlertTriangle className="w-4 h-4" />}
          defaultOpen={defectHistory.some((d) => d.status !== 'resolved' && d.status !== 'verified')}
          badge={
            <span className="text-xs iv-muted ml-2">
              {defectHistory.length} total
              {conditionSummary && conditionSummary.open_defects > 0 && (
                <span className="text-[#F97316] ml-1">
                  · {conditionSummary.open_defects} open
                </span>
              )}
            </span>
          }
        >
          <div className="mt-3 space-y-2">
            {defectHistory.map((defect) => {
              const isOpen = defect.status !== 'resolved' && defect.status !== 'verified';
              const statusLabel = DEFECT_STATUS_LABELS[defect.status] ?? defect.status;
              const statusStyle = DEFECT_STATUS_STYLES[defect.status] ?? 'bg-[#2A2F3A] iv-muted';

              return (
                <div
                  key={defect.id}
                  className={`p-3 rounded-lg ${isOpen ? 'bg-[#F97316]/5' : 'bg-[#1C2029]'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-2xs font-medium px-2 py-0.5 rounded-full ${severityBadgeBg(defect.severity)}`}>
                          {RISK_RATING_LABELS[defect.severity as RiskRating] ?? defect.severity}
                        </span>
                        <span className={`text-2xs font-medium px-1.5 py-0.5 rounded ${statusStyle}`}>
                          {statusLabel}
                        </span>
                        {defect.made_safe && (
                          <span className="text-2xs text-[#22C55E]">
                            <ShieldCheck className="w-3 h-3 inline" /> Safe
                          </span>
                        )}
                      </div>
                      <p className="text-sm iv-text line-clamp-2">{defect.description}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-2xs iv-muted">{formatDate(defect.created_at)}</span>
                        {defect.bs_en_reference && (
                          <>
                            <span className="text-2xs iv-muted">·</span>
                            <span className="text-2xs font-mono iv-muted">{defect.bs_en_reference}</span>
                          </>
                        )}
                        {defect.resolved_at && (
                          <>
                            <span className="text-2xs iv-muted">·</span>
                            <span className="text-2xs text-[#22C55E]">Resolved {formatDate(defect.resolved_at)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <Link
                      to={`/sites/${siteId}/inspections/${defect.inspection_id}/review`}
                      className="iv-btn-icon shrink-0"
                      title="View inspection"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Decommission info (if inactive) ── */}
      {!asset.is_active && (
        <div className="iv-panel p-5 mb-4 border-l-4 border-l-[#EF4444]">
          <h2 className="text-base font-semibold iv-text mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
            Decommissioned
          </h2>
          <div className="divide-y divide-[#2A2F3A]">
            <DetailRow icon={<Calendar className="w-3.5 h-3.5" />} label="Decommissioned Date" value={formatDate(asset.decommissioned_date)} />
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
