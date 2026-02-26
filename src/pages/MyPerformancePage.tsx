/**
 * InspectVoice — My Performance Page
 * Feature 14: Inspector's own stats view
 *
 * Route: /my-performance
 * RBAC: all authenticated org members
 *
 * Thin wrapper around InspectorDetailPage with isSelf=true.
 * Also exports MyPerformanceCard for embedding on the main dashboard.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Loader2,
  ClipboardCheck,
  Camera,
  Clock,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import InspectorDetailPage from './InspectorDetailPage';

// =============================================
// FULL PAGE (route: /my-performance)
// =============================================

export default function MyPerformancePage(): JSX.Element {
  return (
    <>
      <Helmet>
        <title>My Performance | InspectVoice</title>
        <meta name="description" content="Your personal inspection performance and quality insights." />
      </Helmet>
      <InspectorDetailPage isSelf />
    </>
  );
}

// =============================================
// DASHBOARD CARD (embedded on ManagerDashboard)
// =============================================

interface QuickStats {
  inspections_completed: number;
  photo_compliance_pct: number | null;
  avg_time_to_signoff_seconds: number | null;
  completeness_avg: number | null;
}

export function MyPerformanceCard(): JSX.Element {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<QuickStats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch('/api/v1/my-performance?period=month', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json() as { data: { current: QuickStats | null } };
      setStats(json.data.current);
    } catch {
      // Silent fail — card is non-critical
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="iv-panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-iv-accent" />
          <h3 className="text-sm font-semibold iv-text">My Performance</h3>
        </div>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 iv-muted animate-spin" />
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="iv-panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-iv-accent" />
          <h3 className="text-sm font-semibold iv-text">My Performance</h3>
        </div>
        <p className="text-xs iv-muted mb-3">No data for this month yet.</p>
        <Link to="/my-performance" className="text-xs text-iv-accent hover:underline flex items-center gap-1">
          View details <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  const formatMins = (s: number | null): string => {
    if (s === null) return '—';
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  const formatPct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(0)}%`);

  return (
    <div className="iv-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-iv-accent" />
          <h3 className="text-sm font-semibold iv-text">My Performance</h3>
        </div>
        <span className="text-2xs iv-muted">This Month</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <ClipboardCheck className="w-3.5 h-3.5 iv-muted" />
            <span className="text-2xs iv-muted">Inspections</span>
          </div>
          <p className="text-lg font-bold iv-text">{stats.inspections_completed}</p>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <Camera className="w-3.5 h-3.5 iv-muted" />
            <span className="text-2xs iv-muted">Photo Compliance</span>
          </div>
          <p className={`text-lg font-bold ${
            (stats.photo_compliance_pct ?? 0) >= 80 ? 'text-[#22C55E]' :
            (stats.photo_compliance_pct ?? 0) >= 50 ? 'text-[#EAB308]' :
            'text-[#F97316]'
          }`}>
            {formatPct(stats.photo_compliance_pct)}
          </p>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <Clock className="w-3.5 h-3.5 iv-muted" />
            <span className="text-2xs iv-muted">Avg Sign-off</span>
          </div>
          <p className="text-lg font-bold iv-text">{formatMins(stats.avg_time_to_signoff_seconds)}</p>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <BarChart3 className="w-3.5 h-3.5 iv-muted" />
            <span className="text-2xs iv-muted">Completeness</span>
          </div>
          <p className={`text-lg font-bold ${
            (stats.completeness_avg ?? 0) >= 80 ? 'text-[#22C55E]' :
            (stats.completeness_avg ?? 0) >= 50 ? 'text-[#EAB308]' :
            'text-[#F97316]'
          }`}>
            {formatPct(stats.completeness_avg)}
          </p>
        </div>
      </div>

      <Link
        to="/my-performance"
        className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-iv-surface-2 text-xs font-medium iv-text hover:bg-iv-accent/10 hover:text-iv-accent transition-colors"
      >
        View Full Performance
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
