/**
 * InspectVoice — Performance Share Page
 * Feature 14: Token-based "Your Month" view
 *
 * Route: /performance-share/:token
 * Auth: None required — token-scoped, read-only, single inspector's data only.
 *
 * Managers generate share links from the overview table.
 * Inspector receives link → sees their own stats for the given period.
 * Link expires after 30 days.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Loader2,
  AlertTriangle,
  Shield,
  BarChart3,
  ClipboardCheck,
  Camera,
  Clock,
  FileCheck,
  ShieldAlert,
} from 'lucide-react';

// =============================================
// TYPES
// =============================================

interface ShareData {
  inspector_name: string;
  period_start: string;
  period_end: string;
  metrics: MetricsRow[];
}

interface MetricsRow {
  period_start: string;
  period_end: string;
  inspections_completed: number;
  completeness_avg: number | null;
  defects_total: number;
  defects_per_inspection_avg: number | null;
  photo_compliance_pct: number | null;
  evidence_quality_pct: number | null;
  avg_time_to_signoff_seconds: number | null;
  overdue_rate: number | null;
  makesafe_initiated_count: number;
  makesafe_completed_count: number;
  rework_rate: number | null;
  audit_flag_count: number;
}

// =============================================
// HELPERS
// =============================================

function formatPct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

function formatMins(s: number | null): string {
  if (s === null) return '—';
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function pctColour(v: number | null, goodAbove = 80): string {
  if (v === null) return 'iv-muted';
  if (v >= goodAbove) return 'text-[#22C55E]';
  if (v >= 50) return 'text-[#EAB308]';
  return 'text-[#F97316]';
}

function formatPeriod(start: string, end: string): string {
  try {
    const s = new Date(start);
    const e = new Date(end);
    return `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} — ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  } catch {
    return `${start} — ${end}`;
  }
}

// =============================================
// KPI CARD
// =============================================

function KpiCard({
  label,
  value,
  icon,
  valueClass,
}: {
  label: string;
  value: string;
  icon: JSX.Element;
  valueClass?: string;
}): JSX.Element {
  return (
    <div className="bg-[#1C2029] rounded-xl p-4 border border-[#2A2F3A]">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-medium text-[#9CA3AF]">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${valueClass ?? 'text-white'}`}>{value}</p>
    </div>
  );
}

// =============================================
// COMPONENT
// =============================================

export default function PerformanceSharePage(): JSX.Element {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ShareData | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) {
      setError('Invalid link');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/v1/performance-share/${token}`);

      if (res.status === 404) {
        setError('This link is invalid or has been removed.');
        setLoading(false);
        return;
      }

      if (res.status === 410) {
        setError('This link has expired. Please ask your manager for a new one.');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError('Failed to load performance data.');
        setLoading(false);
        return;
      }

      const json = await res.json() as { data: ShareData };
      setData(json.data);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F1117] flex items-center justify-center">
        <Helmet><title>Loading... | InspectVoice</title></Helmet>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-[#9CA3AF] animate-spin" />
          <p className="text-[#9CA3AF] text-sm">Loading your performance summary...</p>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0F1117] flex items-center justify-center px-4">
        <Helmet><title>Error | InspectVoice</title></Helmet>
        <div className="bg-[#1C2029] rounded-2xl border border-[#2A2F3A] p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 text-[#F97316] mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-white mb-2">Cannot Load Summary</h1>
          <p className="text-sm text-[#9CA3AF]">{error}</p>
        </div>
      </div>
    );
  }

  // ── Aggregate metrics across returned rows ──
  const rows = data.metrics;
  const latest = rows.length > 0 ? rows[rows.length - 1]! : null;

  const totalInspections = rows.reduce((s, r) => s + r.inspections_completed, 0);
  const totalDefects = rows.reduce((s, r) => s + r.defects_total, 0);
  const avgPhoto = rows.length > 0
    ? rows.reduce((s, r) => s + (r.photo_compliance_pct ?? 0), 0) / rows.length
    : null;
  const avgEvidence = rows.length > 0
    ? rows.reduce((s, r) => s + (r.evidence_quality_pct ?? 0), 0) / rows.length
    : null;
  const avgSignoff = latest?.avg_time_to_signoff_seconds ?? null;
  const avgOverdue = latest?.overdue_rate ?? null;
  const totalMakesafeInit = rows.reduce((s, r) => s + r.makesafe_initiated_count, 0);
  const totalMakesafeComp = rows.reduce((s, r) => s + r.makesafe_completed_count, 0);

  return (
    <div className="min-h-screen bg-[#0F1117]">
      <Helmet>
        <title>Your Performance | InspectVoice</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      {/* Header */}
      <div className="border-b border-[#2A2F3A] bg-[#1C2029]/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#22C55E]/15 flex items-center justify-center">
            <Shield className="w-5 h-5 text-[#22C55E]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">InspectVoice</h1>
            <p className="text-2xs text-[#9CA3AF]">Performance Summary</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Title card */}
        <div className="bg-[#1C2029] rounded-2xl border border-[#2A2F3A] p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="w-5 h-5 text-[#22C55E]" />
            <h2 className="text-xl font-bold text-white">{data.inspector_name}</h2>
          </div>
          <p className="text-sm text-[#9CA3AF]">
            {formatPeriod(data.period_start, data.period_end)}
          </p>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <KpiCard
            label="Inspections Completed"
            value={String(totalInspections)}
            icon={<ClipboardCheck className="w-4 h-4 text-[#22C55E]" />}
          />
          <KpiCard
            label="Total Defects Found"
            value={String(totalDefects)}
            icon={<AlertTriangle className="w-4 h-4 text-[#F97316]" />}
            valueClass={totalDefects > 0 ? 'text-[#F97316]' : 'text-[#22C55E]'}
          />
          <KpiCard
            label="Photo Compliance"
            value={formatPct(avgPhoto)}
            icon={<Camera className="w-4 h-4 text-[#22C55E]" />}
            valueClass={pctColour(avgPhoto)}
          />
          <KpiCard
            label="Evidence Quality"
            value={formatPct(avgEvidence)}
            icon={<FileCheck className="w-4 h-4 text-[#22C55E]" />}
            valueClass={pctColour(avgEvidence)}
          />
          <KpiCard
            label="Avg Sign-off Time"
            value={formatMins(avgSignoff)}
            icon={<Clock className="w-4 h-4 text-[#9CA3AF]" />}
          />
          <KpiCard
            label="Overdue Rate"
            value={formatPct(avgOverdue)}
            icon={<ShieldAlert className="w-4 h-4 text-[#EAB308]" />}
            valueClass={avgOverdue !== null && avgOverdue <= 10 ? 'text-[#22C55E]' : avgOverdue !== null && avgOverdue <= 25 ? 'text-[#EAB308]' : 'text-[#F97316]'}
          />
        </div>

        {/* Make-safe summary */}
        <div className="bg-[#1C2029] rounded-2xl border border-[#2A2F3A] p-6 mb-6">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#22C55E]" />
            Make-Safe Actions
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xs text-[#9CA3AF] mb-0.5">Initiated</p>
              <p className="text-2xl font-bold text-white">{totalMakesafeInit}</p>
            </div>
            <div>
              <p className="text-2xs text-[#9CA3AF] mb-0.5">Completed</p>
              <p className="text-2xl font-bold text-[#22C55E]">{totalMakesafeComp}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="text-2xs text-[#6B7280]">
            This is a private performance summary generated by InspectVoice.
          </p>
          <p className="text-2xs text-[#6B7280] mt-1">
            &copy; {new Date().getFullYear()} Autaimate Ltd. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
