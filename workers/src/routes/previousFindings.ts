/**
 * InspectVoice — Previous Findings Route Handler
 * Returns open defects from previous inspections for a given asset.
 *
 * Endpoint:
 *   GET /api/v1/assets/:id/previous-findings
 *
 * Returns all unresolved defects ever raised against this asset,
 * ordered by most recent first. Used during capture so inspectors
 * can carry forward, escalate, or resolve prior findings.
 *
 * Tenant isolation: asset → site → org_id chain verified.
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

interface PreviousFindingRow {
  readonly id: string;
  readonly description: string;
  readonly severity: string;
  readonly status: string;
  readonly bs_en_reference: string | null;
  readonly action_timeframe: string | null;
  readonly remedial_action: string | null;
  readonly estimated_cost_band: string | null;
  readonly due_date: string | null;
  readonly created_at: string;
  readonly inspection_id: string;
  readonly inspection_date: string;
  readonly inspection_type: string;
  readonly inspector_name: string;
  readonly made_safe: boolean;
  readonly made_safe_at: string | null;
  readonly consecutive_inspections: number;
}

// =============================================
// GET PREVIOUS FINDINGS
// =============================================

export async function getPreviousFindings(
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

  // ── Get the current inspection ID (if provided) so we exclude it ──
  const url = new URL(_request.url);
  const excludeInspectionId = url.searchParams.get('exclude_inspection_id');

  // ── Deduplicated open defects: only the most recent per unique issue ──
  // Uses DISTINCT ON (bs_en_reference, description) so carried-forward
  // defects don't appear multiple times across inspections.
  const findings = await db.rawQuery<PreviousFindingRow>(
    `SELECT DISTINCT ON (COALESCE(d.bs_en_reference, ''), LEFT(d.description, 100))
      d.id,
      d.description,
      d.severity,
      d.status,
      d.bs_en_reference,
      d.action_timeframe,
      d.remedial_action,
      d.estimated_cost_gbp AS estimated_cost_band,
      d.due_date::text AS due_date,
      d.created_at::text AS created_at,
      ii.inspection_id,
      i.inspection_date::text AS inspection_date,
      i.inspection_type,
      COALESCE(u.first_name || ' ' || u.last_name, u.email, 'Unknown') AS inspector_name,
      COALESCE(d.made_safe, false) AS made_safe,
      d.made_safe_at::text AS made_safe_at,
      (
        SELECT COUNT(DISTINCT i2.id)::int
        FROM inspection_items ii2
        INNER JOIN inspections i2 ON ii2.inspection_id = i2.id
        WHERE i2.org_id = $1
          AND (ii2.asset_id = $2 OR ii2.asset_code = $3)
          AND i2.status != 'draft'
          AND i2.inspection_date >= (
            SELECT MIN(i3.inspection_date)
            FROM inspection_items ii3
            INNER JOIN inspections i3 ON ii3.inspection_id = i3.id
            INNER JOIN defects d3 ON d3.inspection_item_id = ii3.id
            WHERE d3.bs_en_reference = d.bs_en_reference
              AND d3.bs_en_reference IS NOT NULL
              AND i3.org_id = $1
              AND (ii3.asset_id = $2 OR ii3.asset_code = $3)
          )
      ) AS consecutive_inspections
     FROM defects d
     INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
     INNER JOIN inspections i ON ii.inspection_id = i.id
     LEFT JOIN users u ON i.inspector_id = u.id
     WHERE i.org_id = $1
       AND (d.asset_id = $2 OR ii.asset_id = $2 OR ii.asset_code = $3)
       AND i.status != 'draft'
       AND d.status NOT IN ('resolved', 'verified')
       ${excludeInspectionId ? 'AND i.id != $4' : ''}
     ORDER BY
       COALESCE(d.bs_en_reference, ''),
       LEFT(d.description, 100),
       i.inspection_date DESC,
       d.created_at DESC
     LIMIT 50`,
    excludeInspectionId
      ? [ctx.orgId, assetId, asset_code, excludeInspectionId]
      : [ctx.orgId, assetId, asset_code],
  );

  return jsonResponse({
    success: true,
    data: {
      asset_id: assetId,
      findings,
      total: findings.length,
    },
  }, ctx.requestId);
}
