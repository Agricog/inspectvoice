/**
 * InspectVoice — Dashboard Route Handler
 * Aggregated stats for the main dashboard.
 *
 * Endpoints:
 *   GET    /api/v1/dashboard/stats  — Dashboard overview metrics
 *
 * Returns pre-computed counts and summaries for the authenticated org.
 * All queries are tenant-isolated.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { checkRateLimit } from '../middleware/rateLimit';
import { jsonResponse } from './helpers';

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

  // Run all stat queries in parallel for speed
  const [
    siteCounts,
    inspectionCounts,
    defectCounts,
    recentInspections,
    overdueInspections,
    openDefectsByPriority,
  ] = await Promise.all([
    // Site counts by status
    db.rawQuery<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count
       FROM sites WHERE org_id = $1
       GROUP BY status`,
      [ctx.orgId],
    ),

    // Inspection counts by status
    db.rawQuery<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count
       FROM inspections WHERE org_id = $1
       GROUP BY status`,
      [ctx.orgId],
    ),

    // Defect counts by status
    db.rawQuery<{ status: string; count: number }>(
      `SELECT d.status, COUNT(*)::int AS count
       FROM defects d
       INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
       INNER JOIN inspections i ON ii.inspection_id = i.id
       WHERE i.org_id = $1
       GROUP BY d.status`,
      [ctx.orgId],
    ),

    // Recent 5 inspections
    db.rawQuery<Record<string, unknown>>(
      `SELECT i.id, i.inspection_type, i.inspection_date, i.status,
              i.overall_risk_rating, i.total_defects,
              s.name AS site_name
       FROM inspections i
       INNER JOIN sites s ON i.site_id = s.id
       WHERE i.org_id = $1
       ORDER BY i.inspection_date DESC
       LIMIT 5`,
      [ctx.orgId],
    ),

    // Sites overdue for inspection (routine)
    db.rawQuery<Record<string, unknown>>(
      `SELECT s.id, s.name, s.inspection_frequency_routine_days,
              MAX(i.inspection_date) AS last_inspection_date
       FROM sites s
       LEFT JOIN inspections i ON s.id = i.site_id AND i.org_id = $1
       WHERE s.org_id = $1 AND s.status = 'active'
       GROUP BY s.id, s.name, s.inspection_frequency_routine_days
       HAVING MAX(i.inspection_date) IS NULL
          OR MAX(i.inspection_date) < NOW() - (s.inspection_frequency_routine_days || ' days')::interval
       ORDER BY MAX(i.inspection_date) ASC NULLS FIRST
       LIMIT 10`,
      [ctx.orgId],
    ),

    // Open defects by severity
    db.rawQuery<{ severity: string; count: number }>(
      `SELECT d.severity, COUNT(*)::int AS count
       FROM defects d
       INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
       INNER JOIN inspections i ON ii.inspection_id = i.id
       WHERE i.org_id = $1 AND d.status NOT IN ('resolved', 'verified')
       GROUP BY d.severity
       ORDER BY CASE d.severity
         WHEN 'very_high' THEN 1
         WHEN 'high' THEN 2
         WHEN 'medium' THEN 3
         WHEN 'low' THEN 4
       END`,
      [ctx.orgId],
    ),
  ]);

  // Transform counts into lookup objects
  const sites = Object.fromEntries(
    siteCounts.map((r) => [r.status, r.count]),
  );
  const inspections = Object.fromEntries(
    inspectionCounts.map((r) => [r.status, r.count]),
  );
  const defects = Object.fromEntries(
    defectCounts.map((r) => [r.status, r.count]),
  );
  const openDefects = Object.fromEntries(
    openDefectsByPriority.map((r) => [r.severity, r.count]),
  );

  return jsonResponse({
    success: true,
    data: {
      sites: {
        total: Object.values(sites).reduce((sum, c) => sum + (c as number), 0),
        by_status: sites,
      },
      inspections: {
        total: Object.values(inspections).reduce((sum, c) => sum + (c as number), 0),
        by_status: inspections,
      },
      defects: {
        total: Object.values(defects).reduce((sum, c) => sum + (c as number), 0),
        by_status: defects,
        open_by_severity: openDefects,
      },
      recent_inspections: recentInspections,
      overdue_sites: overdueInspections,
    },
  }, ctx.requestId);
}
