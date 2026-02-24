/**
 * InspectVoice — Asset History Route Handler
 * Longitudinal risk and condition data for a single asset.
 *
 * Endpoints:
 *   GET /api/v1/assets/:id/history — Full asset history with trend data
 *
 * Returns:
 *   - Inspection timeline: every inspection that included this asset
 *   - Defect history: all defects ever raised against this asset
 *   - Condition summary: trend direction, repeat issues, first/last dates
 *
 * Tenant isolation: asset → site → org_id chain verified before any data returned.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { checkRateLimit } from '../middleware/rateLimit';
import { NotFoundError } from '../shared/errors';
import { validateUUID } from '../shared/validation';
import { jsonResponse } from './helpers';

// =============================================
// RESULT ROW TYPES
// =============================================

interface InspectionHistoryRow {
  readonly inspection_id: string;
  readonly inspection_date: string;
  readonly inspection_type: string;
  readonly inspector_name: string;
  readonly overall_condition: string | null;
  readonly risk_rating: string | null;
  readonly defect_count: number;
  readonly inspector_notes: string | null;
  readonly site_name: string;
}

interface DefectHistoryRow {
  readonly id: string;
  readonly description: string;
  readonly severity: string;
  readonly status: string;
  readonly bs_en_reference: string | null;
  readonly action_timeframe: string;
  readonly remedial_action: string;
  readonly due_date: string | null;
  readonly created_at: string;
  readonly resolved_at: string | null;
  readonly inspection_id: string;
  readonly inspection_date: string;
  readonly made_safe: boolean;
  readonly made_safe_at: string | null;
}

interface RepeatDefectRow {
  readonly bs_en_reference: string;
  readonly occurrence_count: number;
  readonly last_seen: string;
  readonly severities: string;
}

interface ConditionPointRow {
  readonly inspection_date: string;
  readonly overall_condition: string;
  readonly risk_rating: string | null;
}

// =============================================
// GET ASSET HISTORY
// =============================================

export async function getAssetHistory(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const assetId = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  // Verify asset belongs to this org (via site)
  const assetCheck = await db.rawQuery<{ site_id: string; asset_code: string }>(
    `SELECT a.site_id, a.asset_code
     FROM assets a
     INNER JOIN sites s ON a.site_id = s.id
     WHERE s.org_id = $1 AND a.id = $2
     LIMIT 1`,
    [ctx.orgId, assetId],
  );

  if (!assetCheck[0]) {
    throw new NotFoundError('Asset not found');
  }

  const { asset_code } = assetCheck[0];

  // Run all queries in parallel
  const [
    inspectionHistory,
    defectHistory,
    repeatDefects,
    conditionPoints,
  ] = await Promise.all([
    // ── 1. Inspection timeline ────────────
    // Every inspection that included this asset, newest first
    db.rawQuery<InspectionHistoryRow>(
      `SELECT
        i.id AS inspection_id,
        i.inspection_date::text AS inspection_date,
        i.inspection_type,
        COALESCE(u.first_name || ' ' || u.last_name, u.email, 'Unknown') AS inspector_name,
        ii.overall_condition,
        ii.risk_rating,
        (SELECT COUNT(*)::int FROM defects d2
         WHERE d2.inspection_item_id = ii.id) AS defect_count,
        ii.inspector_notes,
        s.name AS site_name
       FROM inspection_items ii
       INNER JOIN inspections i ON ii.inspection_id = i.id
       INNER JOIN sites s ON i.site_id = s.id
       LEFT JOIN users u ON i.inspector_id = u.id
       WHERE i.org_id = $1
         AND (ii.asset_id = $2 OR ii.asset_code = $3)
         AND i.status != 'draft'
       ORDER BY i.inspection_date DESC
       LIMIT 50`,
      [ctx.orgId, assetId, asset_code],
    ),

    // ── 2. Defect history ────────────
    // All defects ever raised against this asset
    db.rawQuery<DefectHistoryRow>(
      `SELECT
        d.id,
        d.description,
        d.severity,
        d.status,
        d.bs_en_reference,
        d.action_timeframe,
        d.remedial_action,
        d.due_date::text AS due_date,
        d.created_at::text AS created_at,
        d.resolved_at::text AS resolved_at,
        ii.inspection_id,
        i.inspection_date::text AS inspection_date,
        COALESCE(d.made_safe, false) AS made_safe,
        d.made_safe_at::text AS made_safe_at
       FROM defects d
       INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
       INNER JOIN inspections i ON ii.inspection_id = i.id
       WHERE i.org_id = $1
         AND (d.asset_id = $2 OR ii.asset_id = $2 OR ii.asset_code = $3)
       ORDER BY d.created_at DESC
       LIMIT 100`,
      [ctx.orgId, assetId, asset_code],
    ),

    // ── 3. Repeat defect patterns ────────────
    // Same BS EN reference appearing 2+ times = repeat issue
    db.rawQuery<RepeatDefectRow>(
      `SELECT
        d.bs_en_reference,
        COUNT(*)::int AS occurrence_count,
        MAX(d.created_at)::text AS last_seen,
        STRING_AGG(DISTINCT d.severity, ', ' ORDER BY d.severity) AS severities
       FROM defects d
       INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
       INNER JOIN inspections i ON ii.inspection_id = i.id
       WHERE i.org_id = $1
         AND (d.asset_id = $2 OR ii.asset_id = $2 OR ii.asset_code = $3)
         AND d.bs_en_reference IS NOT NULL
       GROUP BY d.bs_en_reference
       HAVING COUNT(*) >= 2
       ORDER BY COUNT(*) DESC, MAX(d.created_at) DESC
       LIMIT 10`,
      [ctx.orgId, assetId, asset_code],
    ),

    // ── 4. Condition data points for timeline chart ────────────
    // Chronological condition ratings over time
    db.rawQuery<ConditionPointRow>(
      `SELECT
        i.inspection_date::text AS inspection_date,
        ii.overall_condition,
        ii.risk_rating
       FROM inspection_items ii
       INNER JOIN inspections i ON ii.inspection_id = i.id
       WHERE i.org_id = $1
         AND (ii.asset_id = $2 OR ii.asset_code = $3)
         AND i.status != 'draft'
         AND ii.overall_condition IS NOT NULL
       ORDER BY i.inspection_date ASC
       LIMIT 50`,
      [ctx.orgId, assetId, asset_code],
    ),
  ]);

  // ── Build condition summary ────────────

  const totalInspections = inspectionHistory.length;
  const firstInspected = conditionPoints.length > 0 ? conditionPoints[0].inspection_date : null;
  const lastInspected = conditionPoints.length > 0 ? conditionPoints[conditionPoints.length - 1].inspection_date : null;
  const currentCondition = conditionPoints.length > 0 ? conditionPoints[conditionPoints.length - 1].overall_condition : null;

  // Compute trend from last 3 condition ratings
  const conditionToNum: Record<string, number> = {
    good: 4,
    fair: 3,
    poor: 2,
    dangerous: 1,
  };

  let conditionTrend: 'improving' | 'stable' | 'deteriorating' | null = null;
  if (conditionPoints.length >= 2) {
    const recent = conditionPoints.slice(-3);
    const values = recent.map((p) => conditionToNum[p.overall_condition] ?? 0).filter((v) => v > 0);
    if (values.length >= 2) {
      const first = values[0];
      const last = values[values.length - 1];
      if (last > first) conditionTrend = 'improving';
      else if (last < first) conditionTrend = 'deteriorating';
      else conditionTrend = 'stable';
    }
  }

  // Total / open / resolved defect counts
  const totalDefects = defectHistory.length;
  const openDefects = defectHistory.filter((d) => d.status !== 'resolved' && d.status !== 'verified').length;
  const resolvedDefects = totalDefects - openDefects;

  return jsonResponse({
    success: true,
    data: {
      asset_id: assetId,
      inspection_history: inspectionHistory,
      defect_history: defectHistory,
      condition_timeline: conditionPoints,
      condition_summary: {
        total_inspections: totalInspections,
        first_inspected: firstInspected,
        last_inspected: lastInspected,
        current_condition: currentCondition,
        condition_trend: conditionTrend,
        total_defects: totalDefects,
        open_defects: openDefects,
        resolved_defects: resolvedDefects,
        repeat_defect_types: repeatDefects,
      },
    },
  }, ctx.requestId);
}
