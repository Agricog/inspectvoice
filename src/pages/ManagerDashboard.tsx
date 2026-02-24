/**
 * InspectVoice — Manager Dashboard
 * Organisation-wide overview: compliance status, risk summary, upcoming inspections,
 * recent activity, and high-priority defect hotlist.
 *
 * Route: / (home page)
 *
 * Features:
 * - Summary stat cards (sites, assets, inspections, defects)
 * - Risk distribution overview (defects by severity)
 * - Upcoming inspections due (compliance calendar)
 * - Recent inspection activity
 * - HOTLIST: top 20 very_high/high open defects — action-oriented,
 *   with SLA indicators, age, made-safe status, one-click drill-in
 * - Responsive grid layout
 * - Loading, error, and empty states
 *
 * API: GET /api/v1/dashboard/stats
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Shield,
  MapPin,
  ClipboardCheck,
  AlertTriangle,
  Calendar,
  ChevronRight,
  Loader2,
  RefreshCw,
  Eye,
  Pencil,
  AlertCircle,
  CheckCircle,
  Layers,
  TrendingUp,
  ShieldCheck,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { useFetch } from '@hooks/useFetch';
import {
  InspectionType,
  InspectionStatus,
  RiskRating,
  DefectStatus,
  ActionTimeframe,
  INSPECTION_TYPE_LABELS,
  INSPECTION_STATUS_LABELS,
  RISK_RATING_LABELS,
  ACTION_TIMEFRAME_LABELS,
} from '@/types/enums';

// =============================================
// TYPES
// =============================================

interface DashboardResponse {
  summary: {
    total_sites: number;
    active_sites: number;
    total_assets: number;
    total_inspections: number;
    inspections_this_month: number;
    open_defects: number;
    overdue_defects: number;
    overdue_inspections: number;
  };
  risk_overview: {
    very_high: number;
    high: number;
    medium: number;
    low: number;
  };
  upcoming_inspections: UpcomingInspection[];
  recent_inspections: RecentInspection[];
  priority_defects: HotlistItem[];
  hotlist: HotlistItem[];
}

interface UpcomingInspection {
  site_id: string;
  site_name: string;
  inspection_type: InspectionType;
  due_date: string;
  days_until_due: number;
  is_overdue: boolean;
}

interface RecentInspection {
  id: string;
  site_id: string;
  site_name: string;
  inspection_type: InspectionType;
  status: InspectionStatus;
  inspection_date: string;
  inspector_name: string;
  overall_risk_rating: RiskRating | null;
  total_defects: number;
}

interface HotlistItem {
  id: string;
  description: string;
  severity: RiskRating;
  status: DefectStatus;
  action_timeframe: ActionTimeframe;
  bs_en_reference: string | null;
  remedial_action: string;
  due_date: string | null;
  estimated_cost_gbp: number | null;
  created_at: string;
  site_id: string;
  site_name: string;
  asset_id: string | null;
  asset_code: string | null;
  inspection_id: string;
  days_open: number;
  days_overdue: number | null;
  made_safe: boolean;
  made_safe_at: string | null;
}

// =============================================
// CONSTANTS
// =============================================

const RISK_STYLES: Record<RiskRating, { bg: string; text: string; dot: string; bar: string }> = {
  [RiskRating.VERY_HIGH]: { bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-400', bar: 'bg-red-500' },
  [RiskRating.HIGH]: { bg: 'bg-orange-500/15', text: 'text-orange-400', dot: 'bg-orange-400', bar: 'bg-orange-500' },
  [RiskRating.MEDIUM]: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', dot: 'bg-yellow-400', bar: 'bg-yellow-500' },
  [RiskRating.LOW]: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400', bar: 'bg-emerald-500' },
};

const STATUS_STYLES: Record<InspectionStatus, { bg: string; text: string }> = {
  [InspectionStatus.DRAFT]: { bg: 'bg-iv-muted/15', text: 'text-iv-muted' },
  [InspectionStatus.REVIEW]: { bg: 'bg-iv-accent/15', text: 'text-iv-accent' },
  [InspectionStatus.SIGNED]: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  [InspectionStatus.EXPORTED]: { bg: 'bg-purple-500/15', text: 'text-purple-400' },
};

// =============================================
// HELPER FUNCTIONS
// =============================================

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

// =============================================
// SUMMARY STAT CARDS
// =============================================

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
  subtitle?: string;
  linkTo?: string;
}

function StatCard({ label, value, icon, accent = 'text-iv-accent', subtitle, linkTo }: StatCardProps): JSX.Element {
  const content = (
    <div className="bg-iv-surface border border-iv-border rounded-xl p-4 hover:border-iv-accent/30 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg bg-iv-surface-2 flex items-center justify-center ${accent}`}>
          {icon}
        </div>
        {linkTo && <ChevronRight className="w-4 h-4 text-iv-muted-2" />}
      </div>
      <p className={`text-2xl font-bold ${accent}`}>{value.toLocaleString('en-GB')}</p>
      <p className="text-xs text-iv-muted mt-0.5">{label}</p>
      {subtitle && <p className="text-2xs text-iv-muted-2 mt-1">{subtitle}</p>}
    </div>
  );

  if (linkTo) {
    return <Link to={linkTo} className="block">{content}</Link>;
  }

  return content;
}

function SummaryStats({ summary }: { summary: DashboardResponse['summary'] }): JSX.Element {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        label="Active Sites"
        value={summary.active_sites}
        icon={<MapPin className="w-4 h-4" />}
        accent="text-iv-accent"
        subtitle={`${summary.total_sites} total`}
        linkTo="/sites"
      />
      <StatCard
        label="Assets Tracked"
        value={summary.total_assets}
        icon={<Layers className="w-4 h-4" />}
        accent="text-iv-accent"
      />
      <StatCard
        label="Open Defects"
        value={summary.open_defects}
        icon={<AlertTriangle className="w-4 h-4" />}
        accent={summary.open_defects > 0 ? 'text-orange-400' : 'text-emerald-400'}
        subtitle={summary.overdue_defects > 0 ? `${summary.overdue_defects} overdue` : undefined}
        linkTo="/defects"
      />
      <StatCard
        label="Inspections This Month"
        value={summary.inspections_this_month}
        icon={<ClipboardCheck className="w-4 h-4" />}
        accent="text-iv-accent"
        subtitle={summary.overdue_inspections > 0 ? `${summary.overdue_inspections} overdue` : 'On track'}
        linkTo="/inspections"
      />
    </div>
  );
}

// =============================================
// RISK OVERVIEW
// =============================================

function RiskOverview({ riskData }: { riskData: DashboardResponse['risk_overview'] }): JSX.Element {
  const total = riskData.very_high + riskData.high + riskData.medium + riskData.low;

  const bars: { key: RiskRating; count: number }[] = [
    { key: RiskRating.VERY_HIGH, count: riskData.very_high },
    { key: RiskRating.HIGH, count: riskData.high },
    { key: RiskRating.MEDIUM, count: riskData.medium },
    { key: RiskRating.LOW, count: riskData.low },
  ];

  return (
    <div className="bg-iv-surface border border-iv-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-iv-accent" />
          <h2 className="text-sm font-semibold text-iv-text">Risk Distribution</h2>
        </div>
        <Link
          to="/defects"
          className="text-2xs text-iv-muted hover:text-iv-accent transition-colors inline-flex items-center gap-1"
        >
          View all
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {total === 0 ? (
        <div className="flex items-center gap-2 py-4 justify-center">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-400 font-medium">No open defects</span>
        </div>
      ) : (
        <div className="space-y-3">
          {bars.map(({ key, count }) => {
            const style = RISK_STYLES[key];
            const percentage = total > 0 ? (count / total) * 100 : 0;

            return (
              <div key={key} className="flex items-center gap-3">
                <span className={`text-2xs font-medium w-20 ${style.text}`}>
                  {RISK_RATING_LABELS[key]}
                </span>
                <div className="flex-1 h-2 bg-iv-surface-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${style.bar} transition-all duration-500`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <span className={`text-xs font-bold w-8 text-right ${style.text}`}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================
// UPCOMING INSPECTIONS (Compliance Calendar)
// =============================================

function UpcomingInspections({ inspections }: { inspections: UpcomingInspection[] }): JSX.Element {
  return (
    <div className="bg-iv-surface border border-iv-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-iv-accent" />
          <h2 className="text-sm font-semibold text-iv-text">Upcoming Inspections</h2>
        </div>
        <Link
          to="/inspections"
          className="text-2xs text-iv-muted hover:text-iv-accent transition-colors inline-flex items-center gap-1"
        >
          View all
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {inspections.length === 0 ? (
        <div className="flex items-center gap-2 py-4 justify-center">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-400 font-medium">All inspections up to date</span>
        </div>
      ) : (
        <ul className="space-y-2">
          {inspections.map((item, index) => {
            const dueLabel = item.is_overdue
              ? `${Math.abs(item.days_until_due)} day${Math.abs(item.days_until_due) !== 1 ? 's' : ''} overdue`
              : item.days_until_due === 0
                ? 'Due today'
                : `Due in ${item.days_until_due} day${item.days_until_due !== 1 ? 's' : ''}`;

            const dueColor = item.is_overdue
              ? 'text-red-400'
              : item.days_until_due <= 7
                ? 'text-yellow-400'
                : 'text-iv-muted';

            return (
              <li
                key={`${item.site_id}-${item.inspection_type}-${index}`}
                className={`flex items-center justify-between gap-3 p-2.5 rounded-lg transition-colors ${
                  item.is_overdue ? 'bg-red-500/5' : 'bg-iv-surface-2/50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/sites/${item.site_id}`}
                    className="text-sm text-iv-text hover:text-iv-accent transition-colors line-clamp-1"
                  >
                    {item.site_name}
                  </Link>
                  <p className="text-2xs text-iv-muted mt-0.5">
                    {INSPECTION_TYPE_LABELS[item.inspection_type]}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-xs font-medium ${dueColor}`}>
                    {item.is_overdue && <AlertCircle className="w-3 h-3 inline mr-1" />}
                    {dueLabel}
                  </p>
                  <p className="text-2xs text-iv-muted-2 mt-0.5">{formatShortDate(item.due_date)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// =============================================
// RECENT INSPECTIONS
// =============================================

function RecentInspections({ inspections }: { inspections: RecentInspection[] }): JSX.Element {
  return (
    <div className="bg-iv-surface border border-iv-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-iv-accent" />
          <h2 className="text-sm font-semibold text-iv-text">Recent Inspections</h2>
        </div>
        <Link
          to="/inspections"
          className="text-2xs text-iv-muted hover:text-iv-accent transition-colors inline-flex items-center gap-1"
        >
          View all
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {inspections.length === 0 ? (
        <p className="text-sm text-iv-muted text-center py-4">No inspections completed yet.</p>
      ) : (
        <ul className="space-y-2">
          {inspections.map((item) => {
            const statusStyle = STATUS_STYLES[item.status];
            const riskStyle = item.overall_risk_rating ? RISK_STYLES[item.overall_risk_rating] : null;

            const actionUrl = item.status === InspectionStatus.DRAFT
              ? `/sites/${item.site_id}/inspections/${item.id}/capture`
              : `/sites/${item.site_id}/inspections/${item.id}/review`;

            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-iv-surface-2/50 hover:bg-iv-surface-2 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={actionUrl}
                      className="text-sm text-iv-text hover:text-iv-accent transition-colors line-clamp-1"
                    >
                      {item.site_name}
                    </Link>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                      {INSPECTION_STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-2xs text-iv-muted">
                      {INSPECTION_TYPE_LABELS[item.inspection_type]}
                    </span>
                    <span className="text-2xs text-iv-muted-2">·</span>
                    <span className="text-2xs text-iv-muted">{formatShortDate(item.inspection_date)}</span>
                    <span className="text-2xs text-iv-muted-2">·</span>
                    <span className="text-2xs text-iv-muted">{item.inspector_name}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {riskStyle && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium ${riskStyle.bg} ${riskStyle.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${riskStyle.dot}`} />
                      {RISK_RATING_LABELS[item.overall_risk_rating as RiskRating]}
                    </span>
                  )}

                  {item.total_defects > 0 && (
                    <span className="text-2xs text-iv-muted">
                      {item.total_defects} defect{item.total_defects !== 1 ? 's' : ''}
                    </span>
                  )}

                  <Link
                    to={actionUrl}
                    className="iv-btn-icon"
                    title={item.status === InspectionStatus.DRAFT ? 'Continue' : 'Review'}
                  >
                    {item.status === InspectionStatus.DRAFT ? (
                      <Pencil className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// =============================================
// HOTLIST — High-Risk Defect Action Panel
// =============================================

function HotlistRow({ defect }: { defect: HotlistItem }): JSX.Element {
  const sevStyle = RISK_STYLES[defect.severity];

  // SLA status
  const slaLabel = defect.days_overdue !== null && defect.days_overdue > 0
    ? `${defect.days_overdue}d overdue`
    : defect.due_date
      ? (() => {
          const daysLeft = Math.round(
            (new Date(defect.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          );
          if (daysLeft === 0) return 'Due today';
          if (daysLeft > 0) return `${daysLeft}d left`;
          return `${Math.abs(daysLeft)}d overdue`;
        })()
      : null;

  const slaColor = defect.days_overdue !== null && defect.days_overdue > 0
    ? 'text-red-400'
    : slaLabel && slaLabel.includes('left') && parseInt(slaLabel) <= 7
      ? 'text-yellow-400'
      : 'text-iv-muted';

  const inspectionUrl = `/sites/${defect.site_id}/inspections/${defect.inspection_id}/review`;

  return (
    <li
      className={`p-3 rounded-lg transition-colors ${
        defect.days_overdue !== null && defect.days_overdue > 0
          ? 'bg-red-500/5 hover:bg-red-500/10'
          : 'bg-iv-surface-2/50 hover:bg-iv-surface-2'
      }`}
    >
      {/* Row 1: severity + description + drill-in */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {/* Severity badge */}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold ${sevStyle.bg} ${sevStyle.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sevStyle.dot}`} />
              {RISK_RATING_LABELS[defect.severity]}
            </span>

            {/* Made Safe indicator */}
            {defect.made_safe && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium bg-emerald-500/15 text-emerald-400">
                <ShieldCheck className="w-3 h-3" />
                Made Safe
              </span>
            )}

            {/* Age */}
            <span className="inline-flex items-center gap-1 text-2xs text-iv-muted">
              <Clock className="w-3 h-3" />
              {defect.days_open}d open
            </span>

            {/* SLA */}
            {slaLabel && (
              <span className={`text-2xs font-medium ${slaColor}`}>
                {defect.days_overdue !== null && defect.days_overdue > 0 && (
                  <AlertCircle className="w-3 h-3 inline mr-0.5" />
                )}
                {slaLabel}
              </span>
            )}
          </div>

          {/* Description */}
          <p className="text-sm text-iv-text line-clamp-1">{defect.description}</p>

          {/* Context: site · asset · timeframe */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Link
              to={`/sites/${defect.site_id}`}
              className="text-2xs text-iv-muted hover:text-iv-accent transition-colors"
            >
              {defect.site_name}
            </Link>
            {defect.asset_code && (
              <>
                <span className="text-2xs text-iv-muted-2">·</span>
                <span className="text-2xs text-iv-muted">{defect.asset_code}</span>
              </>
            )}
            <span className="text-2xs text-iv-muted-2">·</span>
            <span className="text-2xs text-iv-muted">
              {ACTION_TIMEFRAME_LABELS[defect.action_timeframe]}
            </span>
            {defect.bs_en_reference && (
              <>
                <span className="text-2xs text-iv-muted-2">·</span>
                <span className="text-2xs text-iv-muted font-mono">{defect.bs_en_reference}</span>
              </>
            )}
          </div>
        </div>

        {/* Drill-in link */}
        <Link
          to={inspectionUrl}
          className="iv-btn-icon shrink-0"
          title="View inspection"
        >
          <ExternalLink className="w-4 h-4" />
        </Link>
      </div>
    </li>
  );
}

function Hotlist({ defects }: { defects: HotlistItem[] }): JSX.Element {
  return (
    <div className="bg-iv-surface border border-iv-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <h2 className="text-sm font-semibold text-iv-text">
            Hotlist
          </h2>
          {defects.length > 0 && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-2xs font-bold bg-red-500/15 text-red-400">
              {defects.length}
            </span>
          )}
        </div>
        <Link
          to="/defects?severity=very_high&severity=high"
          className="text-2xs text-iv-muted hover:text-iv-accent transition-colors inline-flex items-center gap-1"
        >
          View all
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {defects.length === 0 ? (
        <div className="flex items-center gap-2 py-6 justify-center">
          <CheckCircle className="w-5 h-5 text-emerald-400" />
          <span className="text-sm text-emerald-400 font-medium">
            No high-risk defects outstanding
          </span>
        </div>
      ) : (
        <>
          {/* Column headers (desktop only) */}
          <div className="hidden lg:flex items-center gap-3 px-3 pb-2 mb-1 border-b border-iv-border">
            <span className="text-2xs font-medium text-iv-muted flex-1">
              Severity · Status · Description · Location
            </span>
            <span className="text-2xs font-medium text-iv-muted shrink-0 w-8" />
          </div>

          <ul className="space-y-2">
            {defects.map((defect) => (
              <HotlistRow key={defect.id} defect={defect} />
            ))}
          </ul>

          {/* Overdue summary */}
          {defects.some((d) => d.days_overdue !== null && d.days_overdue > 0) && (
            <div className="mt-3 pt-3 border-t border-iv-border">
              <p className="text-2xs text-red-400 font-medium">
                <AlertCircle className="w-3 h-3 inline mr-1" />
                {defects.filter((d) => d.days_overdue !== null && d.days_overdue > 0).length} defect{defects.filter((d) => d.days_overdue !== null && d.days_overdue > 0).length !== 1 ? 's' : ''} overdue
                — action required
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =============================================
// MAIN DASHBOARD COMPONENT
// =============================================

export function ManagerDashboard(): JSX.Element {
  const { data, loading, error, refetch } = useFetch<DashboardResponse>('/api/v1/dashboard/stats');

  // Provide safe defaults while loading
  const summary = data?.summary ?? {
    total_sites: 0,
    active_sites: 0,
    total_assets: 0,
    total_inspections: 0,
    inspections_this_month: 0,
    open_defects: 0,
    overdue_defects: 0,
    overdue_inspections: 0,
  };

  const riskOverview = data?.risk_overview ?? {
    very_high: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  const upcomingInspections = data?.upcoming_inspections ?? [];
  const recentInspections = data?.recent_inspections ?? [];
  const hotlist = data?.hotlist ?? [];

  return (
    <>
      <Helmet>
        <title>Dashboard — InspectVoice</title>
        <meta name="description" content="InspectVoice compliance dashboard — risk overview, upcoming inspections, and high-risk defect hotlist." />
      </Helmet>

      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-iv-accent/15 flex items-center justify-center">
              <Shield className="w-5 h-5 text-iv-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-iv-text">Dashboard</h1>
              <p className="text-xs text-iv-muted mt-0.5">BS EN 1176 compliance overview</p>
            </div>
          </div>

          <button
            type="button"
            onClick={refetch}
            disabled={loading}
            className="iv-btn-icon"
            aria-label="Refresh dashboard"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Loading state (initial only) */}
        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-16 text-iv-muted">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">Loading dashboard…</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-red-400 mb-1">Failed to load dashboard</p>
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

        {/* Dashboard content */}
        {data && (
          <>
            {/* Summary stats */}
            <SummaryStats summary={summary} />

            {/* HOTLIST — full width, prominent position */}
            <Hotlist defects={hotlist} />

            {/* Two-column grid: risk + upcoming */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <RiskOverview riskData={riskOverview} />
              <UpcomingInspections inspections={upcomingInspections} />
            </div>

            {/* Recent inspections — full width */}
            <RecentInspections inspections={recentInspections} />
          </>
        )}
      </div>
    </>
  );
}

export default ManagerDashboard;
