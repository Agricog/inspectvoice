/**
 * InspectVoice — Dashboard Route Handler
 * Aggregated stats for the main dashboard and hotlist.
 *
 * Endpoints:
 *   GET    /api/v1/dashboard/stats  — Dashboard overview metrics + hotlist
 *
 * Returns pre-computed counts, summaries, and the defect hotlist
 * for the authenticated org. All queries are tenant-isolated.
 *
 * Response shape matches frontend DashboardResponse type exactly.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { checkRateLimit } from '../middleware/rateLimit';
import { jsonResponse } from './helpers';

// =============================================
// RESULT ROW TYPES (from SQL queries)
// =============================================

interface CountByStatus {
  readonly status: string;
  readonly count: number;
}

interface CountBySeverity {
  readonly severity: string;
  readonly count: number;
}

interface SummaryRow {
  readonly total_sites: number;
  readonly active_sites: number;
  readonly total_assets: number;
  readonly total_inspections: number;
  readonly inspections_this_month: number;
  readonly open_defects: number;
  readonly overdue_defects: number;
  readonly overdue_inspections: number;
}

interface UpcomingInspectionRow {
  readonly site_id: string;
  readonly site_name: string;
  readonly inspection_type: string;
  readonly due_date: string;
  readonly days_until_due: number;
  readonly is_overdue: boolean;
}

interface RecentInspectionRow {
  readonly id: string;
  readonly site_id: string;
  readonly site_name: string;
  readonly inspection_type: string;
  readonly status: string;
  readonly inspection_date: string;
  readonly inspector_name: string;
  readonly overall_risk_rating: string | null;
  readonly total_defects: number;
}

interface HotlistRow {
  readonly id: string;
  readonly description: string;
  readonly severity: string;
  readonly status: string;
  readonly action_timeframe: string;
  readonly bs_en_reference: string | null;
  readonly remedial_action: string;
  readonly due_date: string | null;
  readonly estimated_cost_gbp: number | null;
  readonly created_at: string;
  readonly site_id: string;
  readonly site_name: string;
  readonly asset_id: string | null;
  readonly asset_code: string | null;
  readonly inspection_id: string;
  readonly days_open: number;
  readonly days_overdue: number | null;
  readonly made_safe: boolean;
  readonly made_safe_at: string | null;
}

// =============================================
// DASHBOARD STATS
// =============================================

export async function getDashboardStats(
  _request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const db = createDb(ctx);

  // Run all queries in parallel for speed
  const [
    summaryRows,
    openBySeverity,
    upcomingInspections,
    recentInspections,
    hotlistRows,
  ] = await Promise.all([
    // ── 1. Summary stats (single query) ────────
    db.rawQuery<SummaryRow>(
      `SELECT
        (SELECT COUNT(*)::int FROM sites WHERE org_id = $1) AS total_sites,
        (SELECT COUNT(*)::int FROM sites WHERE org_id = $1 AND status = 'active') AS active_sites,
        (SELECT COUNT(*)::int FROM assets a INNER JOIN sites s ON a.site_id = s.id WHERE s.org_id = $1) AS total_assets,
        (SELECT COUNT(*)::int FROM inspections WHERE org_id = $1) AS total_inspections,
        (SELECT COUNT(*)::int FROM inspections WHERE org_id = $1
          AND inspection_date >= date_trunc('month', CURRENT_DATE)) AS inspections_this_month,
        (SELECT COUNT(*)::int FROM defects d
          INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
          INNER JOIN inspections i ON ii.inspection_id = i.id
          WHERE i.org_id = $1 AND d.status NOT IN ('resolved', 'verified')) AS open_defects,
        (SELECT COUNT(*)::int FROM defects d
          INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
          INNER JOIN inspections i ON ii.inspection_id = i.id
          WHERE i.org_id = $1 AND d.status NOT IN ('resolved', 'verified')
            AND d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE) AS overdue_defects,
        (SELECT COUNT(DISTINCT s2.id)::int
          FROM sites s2
          LEFT JOIN LATERAL (
            SELECT MAX(i2.inspection_date) AS last_date
            FROM inspections i2
            WHERE i2.site_id = s2.id AND i2.org_id = $1
          ) li ON true
          WHERE s2.org_id = $1 AND s2.status = 'active'
            AND (li.last_date IS NULL
              OR li.last_date < CURRENT_DATE - (s2.inspection_frequency_routine_days || ' days')::interval)
        ) AS overdue_inspections`,
      [ctx.orgId],
    ),

    // ── 2. Open defects by severity ────────────
    db.rawQuery<CountBySeverity>(
      `SELECT d.severity, COUNT(*)::int AS count
       FROM defects d
       INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
       INNER JOIN inspections i ON ii.inspection_id = i.id
       WHERE i.org_id = $1 AND d.status NOT IN ('resolved', 'verified')
       GROUP BY d.severity
       ORDER BY CASE d.severity
         WHEN 'very_high' THEN 1 WHEN 'high' THEN 2
         WHEN 'medium' THEN 3 WHEN 'low' THEN 4
       END`,
      [ctx.orgId],
    ),

    // ── 3. Upcoming / overdue inspections ──────
    db.rawQuery<UpcomingInspectionRow>(
      `WITH site_due AS (
        SELECT
          s.id AS site_id,
          s.name AS site_name,
          'routine_visual' AS inspection_type,
          s.inspection_frequency_routine_days AS freq,
          MAX(i.inspection_date) AS last_date
        FROM sites s
        LEFT JOIN inspections i ON s.id = i.site_id AND i.org_id = $1
        WHERE s.org_id = $1 AND s.status = 'active'
        GROUP BY s.id, s.name, s.inspection_frequency_routine_days

        UNION ALL

        SELECT
          s.id AS site_id,
          s.name AS site_name,
          'operational' AS inspection_type,
          s.inspection_frequency_operational_days AS freq,
          MAX(i.inspection_date) AS last_date
        FROM sites s
        LEFT JOIN inspections i ON s.id = i.site_id AND i.org_id = $1
          AND i.inspection_type = 'operational'
        WHERE s.org_id = $1 AND s.status = 'active'
        GROUP BY s.id, s.name, s.inspection_frequency_operational_days

        UNION ALL

        SELECT
          s.id AS site_id,
          s.name AS site_name,
          'annual_main' AS inspection_type,
          s.inspection_frequency_annual_days AS freq,
          MAX(i.inspection_date) AS last_date
        FROM sites s
        LEFT JOIN inspections i ON s.id = i.site_id AND i.org_id = $1
          AND i.inspection_type = 'annual_main'
        WHERE s.org_id = $1 AND s.status = 'active'
        GROUP BY s.id, s.name, s.inspection_frequency_annual_days
      )
      SELECT
        site_id,
        site_name,
        inspection_type,
        (COALESCE(last_date, CURRENT_DATE - (freq || ' days')::interval) + (freq || ' days')::interval)::date::text AS due_date,
        EXTRACT(DAY FROM
          (COALESCE(last_date, CURRENT_DATE - (freq || ' days')::interval) + (freq || ' days')::interval) - CURRENT_DATE
        )::int AS days_until_due,
        (COALESCE(last_date, CURRENT_DATE - (freq || ' days')::interval) + (freq || ' days')::interval) < CURRENT_DATE AS is_overdue
      FROM site_due
      WHERE freq > 0
      ORDER BY
        (COALESCE(last_date, CURRENT_DATE - (freq || ' days')::interval) + (freq || ' days')::interval) ASC
      LIMIT 15`,
      [ctx.orgId],
    ),

    // ── 4. Recent inspections ──────────────────
    db.rawQuery<RecentInspectionRow>(
      `SELECT
        i.id,
        i.site_id,
        s.name AS site_name,
        i.inspection_type,
        i.status,
        i.inspection_date::text AS inspection_date,
        COALESCE(u.first_name || ' ' || u.last_name, u.email, 'Unknown') AS inspector_name,
        i.overall_risk_rating,
        i.total_defects
       FROM inspections i
       INNER JOIN sites s ON i.site_id = s.id
       LEFT JOIN users u ON i.inspector_id = u.id
       WHERE i.org_id = $1
       ORDER BY i.inspection_date DESC
       LIMIT 8`,
      [ctx.orgId],
    ),

    // ── 5. HOTLIST — top 20 very_high/high open defects ──
    db.rawQuery<HotlistRow>(
      `SELECT
        d.id,
        d.description,
        d.severity,
        d.status,
        d.action_timeframe,
        d.bs_en_reference,
        d.remedial_action,
        d.due_date::text AS due_date,
        d.estimated_cost_gbp,
        d.created_at::text AS created_at,
        s.id AS site_id,
        s.name AS site_name,
        a.id AS asset_id,
        a.asset_code,
        ii.inspection_id,
        EXTRACT(DAY FROM NOW() - d.created_at)::int AS days_open,
        CASE
          WHEN d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE
          THEN EXTRACT(DAY FROM CURRENT_DATE - d.due_date)::int
          ELSE NULL
        END AS days_overdue,
        COALESCE(d.made_safe, false) AS made_safe,
        d.made_safe_at::text AS made_safe_at
       FROM defects d
       INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
       INNER JOIN inspections i ON ii.inspection_id = i.id
       INNER JOIN sites s ON i.site_id = s.id
       LEFT JOIN assets a ON d.asset_id = a.id
       WHERE i.org_id = $1
         AND d.status NOT IN ('resolved', 'verified')
         AND d.severity IN ('very_high', 'high')
       ORDER BY
         CASE d.severity WHEN 'very_high' THEN 1 WHEN 'high' THEN 2 END,
         d.created_at ASC
       LIMIT 20`,
      [ctx.orgId],
    ),
  ]);

  // ── Build response matching frontend DashboardResponse ──

  const summary = summaryRows[0] ?? {
    total_sites: 0,
    active_sites: 0,
    total_assets: 0,
    total_inspections: 0,
    inspections_this_month: 0,
    open_defects: 0,
    overdue_defects: 0,
    overdue_inspections: 0,
  };

  const severityMap = Object.fromEntries(
    openBySeverity.map((r) => [r.severity, r.count]),
  );

  return jsonResponse({
    summary,
    risk_overview: {
      very_high: (severityMap['very_high'] as number) ?? 0,
      high: (severityMap['high'] as number) ?? 0,
      medium: (severityMap['medium'] as number) ?? 0,
      low: (severityMap['low'] as number) ?? 0,
    },
    upcoming_inspections: upcomingInspections,
    recent_inspections: recentInspections,
    priority_defects: hotlistRows,
    hotlist: hotlistRows,
  }, ctx.requestId);
}
