/**
 * InspectVoice — Performance Dashboard Section
 * Feature 14: Drop-in component for ManagerDashboard.tsx
 *
 * Shows two things:
 *   1. For managers/admins: org-wide quick stats + link to full overview
 *   2. For all members: "My Performance" card via MyPerformanceCard
 *
 * Usage in ManagerDashboard.tsx:
 *   import { PerformanceDashboardSection } from '@components/PerformanceDashboardSection';
 *   // Inside render:
 *   <PerformanceDashboardSection />
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  Users,
  ArrowRight,
  Loader2,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { useAuth, useOrganization } from '@clerk/clerk-react';
import { MyPerformanceCard } from '@pages/MyPerformancePage';

// =============================================
// ORG PERFORMANCE SUMMARY (manager/admin only)
// =============================================

interface OrgQuickStats {
  inspector_count: number;
  total_inspections: number;
  avg_photo_compliance: number | null;
  avg_overdue_rate: number | null;
}

function OrgPerformanceCard(): JSX.Element {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OrgQuickStats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch('/api/v1/inspector-performance?period=month', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;

      const json = await res.json() as {
        data: {
          inspectors: Array<{
            inspections_completed: number;
            photo_compliance_pct: number | null;
            overdue_rate: number | null;
          }>;
        };
      };

      const inspectors = json.data.inspectors;
      if (inspectors.length === 0) {
        setStats(null);
        return;
      }

      const totalInspections = inspectors.reduce((s, i) => s + i.inspections_completed, 0);
      const photoValues = inspectors.map((i) => i.photo_compliance_pct).filter((v): v is number => v !== null);
      const overdueValues = inspectors.map((i) => i.overdue_rate).filter((v): v is number => v !== null);

      setStats({
        inspector_count: inspectors.length,
        total_inspections: totalInspections,
        avg_photo_compliance: photoValues.length > 0
          ? photoValues.reduce((s, v) => s + v, 0) / photoValues.length
          : null,
        avg_overdue_rate: overdueValues.length > 0
          ? overdueValues.reduce((s, v) => s + v, 0) / overdueValues.length
          : null,
      });
    } catch {
      // Silent — dashboard card is non-critical
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
          <Users className="w-4 h-4 text-iv-accent" />
          <h3 className="text-sm font-semibold iv-text">Team Performance</h3>
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
          <Users className="w-4 h-4 text-iv-accent" />
          <h3 className="text-sm font-semibold iv-text">Team Performance</h3>
        </div>
        <p className="text-xs iv-muted mb-3">No team data this month yet.</p>
        <Link to="/inspector-performance" className="text-xs text-iv-accent hover:underline flex items-center gap-1">
          View Performance <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  return (
    <div className="iv-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-iv-accent" />
          <h3 className="text-sm font-semibold iv-text">Team Performance</h3>
        </div>
        <span className="text-2xs iv-muted">This Month</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-2xs iv-muted mb-0.5">Inspectors Active</p>
          <p className="text-lg font-bold iv-text">{stats.inspector_count}</p>
        </div>
        <div>
          <p className="text-2xs iv-muted mb-0.5">Total Inspections</p>
          <p className="text-lg font-bold iv-text">{stats.total_inspections}</p>
        </div>
        <div>
          <p className="text-2xs iv-muted mb-0.5">Avg Photo Compliance</p>
          <p className={`text-lg font-bold ${
            (stats.avg_photo_compliance ?? 0) >= 80 ? 'text-[#22C55E]' :
            (stats.avg_photo_compliance ?? 0) >= 50 ? 'text-[#EAB308]' :
            'text-[#F97316]'
          }`}>
            {stats.avg_photo_compliance !== null ? `${stats.avg_photo_compliance.toFixed(0)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-2xs iv-muted mb-0.5">Avg Overdue Rate</p>
          <p className={`text-lg font-bold ${
            (stats.avg_overdue_rate ?? 0) <= 10 ? 'text-[#22C55E]' :
            (stats.avg_overdue_rate ?? 0) <= 25 ? 'text-[#EAB308]' :
            'text-[#F97316]'
          }`}>
            {stats.avg_overdue_rate !== null ? `${stats.avg_overdue_rate.toFixed(0)}%` : '—'}
          </p>
        </div>
      </div>

      <Link
        to="/inspector-performance"
        className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-iv-surface-2 text-xs font-medium iv-text hover:bg-iv-accent/10 hover:text-iv-accent transition-colors"
      >
        View Full Performance
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

// =============================================
// COMBINED SECTION
// =============================================

export function PerformanceDashboardSection(): JSX.Element {
  const { membership } = useOrganization();
  const isManager = membership?.role === 'org:admin' || membership?.role === 'org:manager' || membership?.role === 'admin';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {isManager && <OrgPerformanceCard />}
      <MyPerformanceCard />
    </div>
  );
}
