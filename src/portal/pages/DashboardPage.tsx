/**
 * InspectVoice — Portal Dashboard Page
 * src/portal/pages/DashboardPage.tsx
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchDashboard, type PortalDashboard } from '../api/portalApi';

export function DashboardPage() {
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorCard message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {data.workspace && (
        <div>
          <h2 className="text-xl font-bold text-gray-900">{data.workspace.name}</h2>
          <p className="text-sm text-gray-500 mt-1">Compliance overview</p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Sites" value={data.site_count} icon="📍" href="/portal/sites" />
        <StatCard
          label="Open Defects"
          value={data.total_defects_open}
          icon="⚠️"
          href="/portal/defects"
          variant={data.total_defects_open > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Critical"
          value={data.critical_defects_open}
          icon="🔴"
          href="/portal/defects?severity=very_high"
          variant={data.critical_defects_open > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Pending Actions"
          value={data.pending_actions}
          icon="📝"
          href="/portal/defects"
          variant={data.pending_actions > 0 ? 'info' : 'default'}
        />
      </div>

      {/* Recent reports */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Recent Inspection Reports</h3>
          <Link to="/portal/inspections" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            View all
          </Link>
        </div>

        {data.recent_reports.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">No inspection reports yet</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.recent_reports.map((r) => (
              <Link
                key={r.inspection_id}
                to={`/portal/inspections/${r.inspection_id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.site_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {fmtType(r.inspection_type)} · {fmtDate(r.signed_at)}
                  </p>
                </div>
                {r.overall_risk_rating && <RiskBadge rating={r.overall_risk_rating} />}
                <span className="text-xs text-gray-400">{r.total_defects} defect{r.total_defects !== 1 ? 's' : ''}</span>
                <Chevron />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared helpers used across portal pages ──

export function RiskBadge({ rating }: { rating: string }) {
  const c: Record<string, string> = {
    very_high: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-green-100 text-green-700',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c[rating] ?? 'bg-gray-100 text-gray-600'}`}>
      {rating.replace(/_/g, ' ')}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const c: Record<string, string> = {
    very_high: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-green-100 text-green-700',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c[severity] ?? 'bg-gray-100 text-gray-600'}`}>
      {severity.replace(/_/g, ' ').toUpperCase()}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const c: Record<string, string> = {
    open: 'bg-red-100 text-red-700',
    in_progress: 'bg-blue-100 text-blue-700',
    resolved: 'bg-green-100 text-green-700',
    verified: 'bg-emerald-100 text-emerald-700',
    deferred: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function Chevron() {
  return (
    <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-6 w-48 bg-gray-200 rounded" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
      </div>
      <div className="h-64 bg-gray-200 rounded-xl" />
    </div>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
      <p className="text-red-700 font-medium">Something went wrong</p>
      <p className="text-red-500 text-sm mt-1">{message}</p>
    </div>
  );
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatCard({
  label, value, icon, href, variant = 'default',
}: {
  label: string; value: number; icon: string; href: string;
  variant?: 'default' | 'warning' | 'danger' | 'info';
}) {
  const bg: Record<string, string> = {
    default: 'bg-white', warning: 'bg-amber-50 border-amber-200',
    danger: 'bg-red-50 border-red-200', info: 'bg-blue-50 border-blue-200',
  };
  const vc: Record<string, string> = {
    default: 'text-gray-900', warning: 'text-amber-700',
    danger: 'text-red-700', info: 'text-blue-700',
  };
  return (
    <Link to={href} className={`${bg[variant]} rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${vc[variant]}`}>{value}</p>
    </Link>
  );
}
