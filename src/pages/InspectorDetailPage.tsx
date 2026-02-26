/**
 * InspectVoice — Inspector Detail / My Performance Page
 * Feature 14: KPI cards + trend charts + breakdown by type
 *
 * Routes:
 *   /inspector-performance/:userId  → manager drill-in (admin/manager only)
 *   /my-performance                 → current user's own stats (all members)
 *
 * Shows:
 *   - KPI cards: inspections, completeness, defects/inspection, photo compliance,
 *     evidence quality, avg sign-off time, overdue rate, make-safe, rework, flags
 *   - Trend charts (6-month sparklines per metric)
 *   - Breakdown by inspection type
 *   - Benchmark band indicators (top 25% / middle / bottom 25%)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  ClipboardCheck,
  Camera,
  FileCheck,
  Clock,
  ShieldAlert,
  AlertCircle,
  BarChart3,
  ChevronDown,
} from 'lucide-react';
import { useAuth, useUser } from '@clerk/clerk-react';
import type { PeriodPreset, MetricTrend, TrendDirection, InspectorMetricsPeriod } from '@/types/features14_15';
import { PERIOD_PRESET_LABELS } from '@/types/features14_15';
import { INSPECTION_TYPE_LABELS } from '@/types';

// =============================================
// TYPES
// =============================================

interface DetailResponse {
  inspector_user_id: string;
  inspector_name: string;
  period: { start: string; end: string; preset: string };
  current: InspectorMetricsPeriod | null;
  by_inspection_type: InspectorMetricsPeriod[];
}

interface TrendsResponse {
  inspector_user_id: string;
  trends: MetricTrend[];
}

interface BenchmarkBand {
  metric_key: string;
  top_25: number | null;
  median: number | null;
  bottom_25: number | null;
  inspector_value: number | null;
  band: 'top' | 'middle' | 'bottom';
}

// =============================================
// HELPERS
// =============================================

function formatMinutes(seconds: number | null): string {
  if (seconds === null) return '—';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(1)}%`;
}

function formatNum(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString();
}

function trendIcon(direction: TrendDirection): JSX.Element {
  switch (direction) {
    case 'improving':
      return <TrendingUp className="w-4 h-4 text-[#22C55E]" />;
    case 'declining':
      return <TrendingDown className="w-4 h-4 text-[#EF4444]" />;
    default:
      return <Minus className="w-4 h-4 iv-muted" />;
  }
}

function trendColour(direction: TrendDirection): string {
  switch (direction) {
    case 'improving': return 'text-[#22C55E]';
    case 'declining': return 'text-[#EF4444]';
    default: return 'iv-muted';
  }
}

function bandBadge(band: 'top' | 'middle' | 'bottom'): JSX.Element {
  const config = {
    top: { label: 'Top 25%', cls: 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30' },
    middle: { label: 'Middle 50%', cls: 'bg-[#EAB308]/15 text-[#EAB308] border-[#EAB308]/30' },
    bottom: { label: 'Bottom 25%', cls: 'bg-[#F97316]/15 text-[#F97316] border-[#F97316]/30' },
  };
  const c = config[band];
  return (
    <span className={`text-2xs font-medium px-2 py-0.5 rounded-full border ${c.cls}`}>
      {c.label}
    </span>
  );
}

// =============================================
// SPARKLINE (inline SVG)
// =============================================

function Sparkline({ dataPoints, colour = '#22C55E' }: { dataPoints: Array<{ value: number | null }>; colour?: string }): JSX.Element {
  const values = dataPoints.map((dp) => dp.value).filter((v): v is number => v !== null);
  if (values.length < 2) return <div className="w-24 h-8" />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 96;
  const h = 32;
  const padding = 2;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (w - padding * 2);
    const y = h - padding - ((v - min) / range) * (h - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={colour}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// =============================================
// KPI CARD
// =============================================

function KpiCard({
  label,
  value,
  icon,
  trend,
  benchmark,
  subtext,
}: {
  label: string;
  value: string;
  icon: JSX.Element;
  trend?: MetricTrend;
  benchmark?: BenchmarkBand;
  subtext?: string;
}): JSX.Element {
  return (
    <div className="iv-panel p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-medium iv-muted">{label}</span>
        </div>
        {benchmark && bandBadge(benchmark.band)}
      </div>
      <p className="text-2xl font-bold iv-text mb-1">{value}</p>
      <div className="flex items-center justify-between">
        {trend ? (
          <div className="flex items-center gap-1.5">
            {trendIcon(trend.direction)}
            <span className={`text-xs font-medium ${trendColour(trend.direction)}`}>
              {trend.direction === 'stable' ? 'Stable' : trend.direction === 'improving' ? 'Improving' : 'Declining'}
            </span>
          </div>
        ) : (
          <span />
        )}
        {trend && <Sparkline dataPoints={trend.data_points} colour={trend.direction === 'declining' ? '#EF4444' : '#22C55E'} />}
      </div>
      {subtext && <p className="text-2xs iv-muted mt-1">{subtext}</p>}
    </div>
  );
}

// =============================================
// MAIN COMPONENT
// =============================================

interface Props {
  /** If true, shows current user's own stats (no userId param needed) */
  isSelf?: boolean;
}

export default function InspectorDetailPage({ isSelf = false }: Props): JSX.Element {
  const { userId: paramUserId } = useParams<{ userId: string }>();
  const { getToken } = useAuth();
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [trends, setTrends] = useState<MetricTrend[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkBand[]>([]);
  const [period, setPeriod] = useState<PeriodPreset>('month');
  const [showTypeBreakdown, setShowTypeBreakdown] = useState(false);

  const baseUrl = isSelf ? '/api/v1/my-performance' : `/api/v1/inspector-performance/${paramUserId}`;
  const trendsUrl = isSelf ? '/api/v1/my-performance/trends' : `/api/v1/inspector-performance/${paramUserId}`;
  const pageTitle = isSelf ? 'My Performance' : detail?.inspector_name ?? 'Inspector Detail';

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
      const params = new URLSearchParams({ period });

      const [detailRes, trendsRes, benchRes] = await Promise.all([
        fetch(`${baseUrl}?${params}`, { headers }),
        fetch(`${isSelf ? '/api/v1/my-performance/trends' : `${baseUrl}?${params}`}`, { headers }),
        fetch(`/api/v1/inspector-performance/benchmarks?${params}`, { headers }),
      ]);

      if (!detailRes.ok) throw new Error(`Detail: ${detailRes.status}`);
      const detailJson = await detailRes.json() as { data: DetailResponse };
      setDetail(detailJson.data);

      if (trendsRes.ok) {
        const trendsJson = await trendsRes.json() as { data: TrendsResponse };
        setTrends(trendsJson.data.trends ?? []);
      }

      if (benchRes.ok) {
        const benchJson = await benchRes.json() as { data: { bands: BenchmarkBand[] } };
        setBenchmarks(benchJson.data.bands ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken, baseUrl, period, isSelf]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Helpers to find trend/benchmark by metric key
  const findTrend = (key: string): MetricTrend | undefined => trends.find((t) => t.metric_key === key);
  const findBench = (key: string): BenchmarkBand | undefined => benchmarks.find((b) => b.metric_key === key);

  // ── Loading / Error ──
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Helmet><title>{pageTitle} | InspectVoice</title></Helmet>
        <Loader2 className="w-8 h-8 iv-muted animate-spin" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="max-w-3xl mx-auto py-8">
        <Helmet><title>Error | InspectVoice</title></Helmet>
        <div className="iv-panel p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="iv-muted text-sm mb-4">{error ?? 'No data found'}</p>
          <button type="button" onClick={fetchAll} className="iv-btn-primary">Retry</button>
        </div>
      </div>
    );
  }

  const c = detail.current;

  return (
    <div className="max-w-5xl mx-auto">
      <Helmet>
        <title>{pageTitle} | InspectVoice</title>
      </Helmet>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            to={isSelf ? '/' : '/inspector-performance'}
            className="iv-btn-icon"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold iv-text flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-iv-accent" />
              {pageTitle}
            </h1>
            <p className="text-sm iv-muted">{detail.period.start} — {detail.period.end}</p>
          </div>
        </div>
      </div>

      {/* Period pills */}
      <div className="flex flex-wrap gap-1.5 mb-6">
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

      {/* No data for period */}
      {!c ? (
        <div className="iv-panel p-8 text-center">
          <BarChart3 className="w-12 h-12 iv-muted mx-auto mb-3 opacity-50" />
          <p className="iv-muted text-sm">No performance data for this period.</p>
        </div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            <KpiCard
              label="Inspections Completed"
              value={formatNum(c.inspections_completed)}
              icon={<ClipboardCheck className="w-4 h-4 text-iv-accent" />}
              trend={findTrend('inspections_completed')}
            />
            <KpiCard
              label="Completeness Avg"
              value={formatPct(c.completeness_avg)}
              icon={<FileCheck className="w-4 h-4 text-iv-accent" />}
              trend={findTrend('completeness_avg')}
              benchmark={findBench('completeness_avg')}
            />
            <KpiCard
              label="Defects / Inspection"
              value={c.defects_per_inspection_avg?.toFixed(1) ?? '—'}
              icon={<AlertCircle className="w-4 h-4 text-[#F97316]" />}
              trend={findTrend('defects_per_inspection_avg')}
              benchmark={findBench('defects_per_inspection_avg')}
              subtext={`${c.defects_total} total defects`}
            />
            <KpiCard
              label="Photo Compliance"
              value={formatPct(c.photo_compliance_pct)}
              icon={<Camera className="w-4 h-4 text-iv-accent" />}
              trend={findTrend('photo_compliance_pct')}
              benchmark={findBench('photo_compliance_pct')}
            />
            <KpiCard
              label="Evidence Quality"
              value={formatPct(c.evidence_quality_pct)}
              icon={<FileCheck className="w-4 h-4 text-iv-accent" />}
              trend={findTrend('evidence_quality_pct')}
              benchmark={findBench('evidence_quality_pct')}
              subtext="Defects with photo + notes"
            />
            <KpiCard
              label="Avg Sign-off Time"
              value={formatMinutes(c.avg_time_to_signoff_seconds)}
              icon={<Clock className="w-4 h-4 iv-muted" />}
              trend={findTrend('avg_time_to_signoff_seconds')}
            />
            <KpiCard
              label="Overdue Rate"
              value={formatPct(c.overdue_rate)}
              icon={<AlertTriangle className="w-4 h-4 text-[#F97316]" />}
              trend={findTrend('overdue_rate')}
              benchmark={findBench('overdue_rate')}
            />
            <KpiCard
              label="Rework Rate"
              value={formatPct(c.rework_rate)}
              icon={<ShieldAlert className="w-4 h-4 text-[#EAB308]" />}
              trend={findTrend('rework_rate')}
              benchmark={findBench('rework_rate')}
            />
            <KpiCard
              label="Make-Safe Actions"
              value={`${c.makesafe_initiated_count} / ${c.makesafe_completed_count}`}
              icon={<ShieldAlert className="w-4 h-4 text-[#22C55E]" />}
              subtext="Initiated / Completed"
            />
          </div>

          {/* Normalisation + Audit */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="iv-panel p-4">
              <p className="text-xs font-medium iv-muted mb-1">Normalisation Accept Rate</p>
              <p className="text-xl font-bold iv-text">{formatPct(c.normalisation_accept_rate)}</p>
            </div>
            <div className="iv-panel p-4">
              <p className="text-xs font-medium iv-muted mb-1">Audit Flags</p>
              <p className={`text-xl font-bold ${c.audit_flag_count > 0 ? 'text-[#F97316]' : 'text-[#22C55E]'}`}>
                {c.audit_flag_count}
              </p>
              <p className="text-2xs iv-muted">BS EN edits + normalisation rejects</p>
            </div>
          </div>

          {/* By Inspection Type */}
          {detail.by_inspection_type.length > 0 && (
            <div className="iv-panel mb-6">
              <button
                type="button"
                onClick={() => setShowTypeBreakdown((prev) => !prev)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-iv-surface-2/50 transition-colors"
              >
                <h2 className="text-base font-semibold iv-text">By Inspection Type</h2>
                <ChevronDown className={`w-4 h-4 iv-muted transition-transform ${showTypeBreakdown ? 'rotate-180' : ''}`} />
              </button>
              {showTypeBreakdown && (
                <div className="px-4 pb-4 overflow-x-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead>
                      <tr className="border-b border-iv-border">
                        <th className="text-left py-2 text-xs iv-muted font-medium">Type</th>
                        <th className="text-right py-2 text-xs iv-muted font-medium">Inspections</th>
                        <th className="text-right py-2 text-xs iv-muted font-medium">Defects</th>
                        <th className="text-right py-2 text-xs iv-muted font-medium">Photo %</th>
                        <th className="text-right py-2 text-xs iv-muted font-medium">Avg Sign-off</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.by_inspection_type.map((row) => (
                        <tr key={row.inspection_type ?? 'all'} className="border-b border-iv-border/30">
                          <td className="py-2 iv-text">
                            {row.inspection_type
                              ? INSPECTION_TYPE_LABELS[row.inspection_type as keyof typeof INSPECTION_TYPE_LABELS] ?? row.inspection_type
                              : 'All'}
                          </td>
                          <td className="text-right py-2 iv-text">{row.inspections_completed}</td>
                          <td className="text-right py-2 iv-text">{row.defects_total}</td>
                          <td className="text-right py-2 iv-text">{formatPct(row.photo_compliance_pct)}</td>
                          <td className="text-right py-2 iv-muted">{formatMinutes(row.avg_time_to_signoff_seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
