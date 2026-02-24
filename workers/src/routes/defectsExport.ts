/**
 * InspectVoice — Defects Export Route Handler
 * Returns ALL defects for the organisation (unpaginated) for client-side
 * Excel/CSV generation.
 *
 * Endpoint:
 *   GET /api/v1/defects/export  — All defects with full context (site, asset, inspection, photos)
 *
 * Query params (all optional):
 *   status     — filter by defect status
 *   severity   — filter by severity
 *   site_id    — filter by specific site
 *   from_date  — inspection date >= (ISO date)
 *   to_date    — inspection date <= (ISO date)
 *
 * Rate limit: 'export' tier (stricter — max 10/hr)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { checkRateLimit } from '../middleware/rateLimit';
import { parseFilterParam } from '../shared/pagination';
import { jsonResponse } from './helpers';

// =============================================
// ALLOWED VALUES
// =============================================

const DEFECT_STATUSES = [
  'open', 'assigned', 'in_progress', 'resolved', 'verified', 'deferred', 'not_actioned',
] as const;

const DEFECT_SEVERITIES = ['very_high', 'high', 'medium', 'low'] as const;

// =============================================
// TYPES
// =============================================

interface ExportDefect {
  id: string;
  description: string;
  remedial_action: string;
  bs_en_reference: string | null;
  severity: string;
  status: string;
  action_timeframe: string;
  due_date: string | null;
  estimated_cost_gbp: number | null;
  actual_cost_gbp: number | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  deferral_reason: string | null;
  notes: string | null;
  // Joined fields
  site_id: string;
  site_name: string;
  site_address: string | null;
  site_local_authority: string | null;
  asset_code: string;
  asset_type: string;
  asset_zone: string | null;
  inspection_id: string;
  inspection_type: string;
  inspection_date: string;
  inspector_name: string;
  assigned_to_name: string | null;
  photo_count: number;
  photo_r2_keys: string | null;
}

interface SiteSummary {
  site_id: string;
  site_name: string;
  site_address: string | null;
  total_assets: number;
  total_defects: number;
  open_defects: number;
  very_high_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
}

// =============================================
// EXPORT ENDPOINT
// =============================================

export async function exportDefects(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'export');

  const db = createDb(ctx);

  // ── Parse optional filters ─────────────────
  const statusFilter = parseFilterParam(request, 'status');
  const severityFilter = parseFilterParam(request, 'severity');
  const siteFilter = parseFilterParam(request, 'site_id');

  const url = new URL(request.url);
  const fromDate = url.searchParams.get('from_date');
  const toDate = url.searchParams.get('to_date');

  // ── Build WHERE clause ─────────────────────
  const conditions: string[] = ['i.org_id = $1'];
  const params: unknown[] = [ctx.orgId];
  let paramIndex = 2;

  if (statusFilter && DEFECT_STATUSES.includes(statusFilter as typeof DEFECT_STATUSES[number])) {
    conditions.push(`d.status = $${paramIndex}`);
    params.push(statusFilter);
    paramIndex++;
  }

  if (severityFilter && DEFECT_SEVERITIES.includes(severityFilter as typeof DEFECT_SEVERITIES[number])) {
    conditions.push(`d.severity = $${paramIndex}`);
    params.push(severityFilter);
    paramIndex++;
  }

  if (siteFilter) {
    conditions.push(`i.site_id = $${paramIndex}`);
    params.push(siteFilter);
    paramIndex++;
  }

  if (fromDate) {
    conditions.push(`i.inspection_date >= $${paramIndex}`);
    params.push(fromDate);
    paramIndex++;
  }

  if (toDate) {
    conditions.push(`i.inspection_date <= $${paramIndex}`);
    params.push(toDate);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // ── Fetch all defects with full context ────
  const defectsSql = `
    SELECT
      d.id,
      d.description,
      d.remedial_action,
      d.bs_en_reference,
      d.severity,
      d.status,
      d.action_timeframe,
      d.due_date,
      d.estimated_cost_gbp,
      d.actual_cost_gbp,
      d.created_at,
      d.updated_at,
      d.resolved_at,
      d.resolution_notes,
      d.deferral_reason,
      d.notes,
      i.site_id,
      s.name AS site_name,
      s.address AS site_address,
      s.local_authority AS site_local_authority,
      ii.asset_code,
      ii.asset_type,
      ii.zone AS asset_zone,
      i.id AS inspection_id,
      i.inspection_type,
      i.inspection_date,
      COALESCE(u_insp.first_name || ' ' || u_insp.last_name, 'Unknown') AS inspector_name,
      COALESCE(u_assign.first_name || ' ' || u_assign.last_name, NULL) AS assigned_to_name,
      COALESCE(d.photo_count, 0)::int AS photo_count,
      d.photo_r2_keys
    FROM defects d
    INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
    INNER JOIN inspections i ON ii.inspection_id = i.id
    INNER JOIN sites s ON i.site_id = s.id
    LEFT JOIN users u_insp ON i.inspector_id = u_insp.id
    LEFT JOIN users u_assign ON d.assigned_to = u_assign.id
    WHERE ${whereClause}
    ORDER BY
      CASE d.severity
        WHEN 'very_high' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END ASC,
      d.created_at DESC
  `;

  const defects = await db.rawQuery<ExportDefect>(defectsSql, params);

  // ── Fetch site summary data ────────────────
  const summarySql = `
    SELECT
      s.id AS site_id,
      s.name AS site_name,
      s.address AS site_address,
      COUNT(DISTINCT a.id)::int AS total_assets,
      COUNT(d.id)::int AS total_defects,
      COUNT(d.id) FILTER (WHERE d.status NOT IN ('resolved', 'verified'))::int AS open_defects,
      COUNT(d.id) FILTER (WHERE d.severity = 'very_high')::int AS very_high_count,
      COUNT(d.id) FILTER (WHERE d.severity = 'high')::int AS high_count,
      COUNT(d.id) FILTER (WHERE d.severity = 'medium')::int AS medium_count,
      COUNT(d.id) FILTER (WHERE d.severity = 'low')::int AS low_count
    FROM sites s
    LEFT JOIN assets a ON a.site_id = s.id
    LEFT JOIN inspections i ON i.site_id = s.id AND i.org_id = $1
    LEFT JOIN inspection_items ii ON ii.inspection_id = i.id
    LEFT JOIN defects d ON d.inspection_item_id = ii.id
    WHERE s.org_id = $1
    GROUP BY s.id, s.name, s.address
    ORDER BY s.name ASC
  `;

  const siteSummaries = await db.rawQuery<SiteSummary>(summarySql, [ctx.orgId]);

  // ── Response ───────────────────────────────
  return jsonResponse({
    success: true,
    data: {
      defects,
      site_summaries: siteSummaries,
      export_meta: {
        org_id: ctx.orgId,
        exported_at: new Date().toISOString(),
        total_defects: defects.length,
        total_sites: siteSummaries.length,
        filters: {
          status: statusFilter ?? null,
          severity: severityFilter ?? null,
          site_id: siteFilter ?? null,
          from_date: fromDate ?? null,
          to_date: toDate ?? null,
        },
      },
    },
  }, ctx.requestId);
}
