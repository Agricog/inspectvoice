/**
 * InspectVoice — Claims Pack Route Handler
 * One-click evidence pack generation for incident defence.
 *
 * Endpoint:
 *   GET /api/v1/incidents/:id/claims-pack — Generate claims evidence pack
 *
 * Gathers all evidence related to an incident into a structured JSON response:
 *   - The incident record itself
 *   - Site details and inspection schedule
 *   - Linked asset details + condition history
 *   - Linked defect + remedial actions taken
 *   - All inspections at the site in the 12 months before the incident
 *   - All defects found at the site in the 12 months before the incident
 *   - Make-safe actions taken
 *   - Compliance summary: were inspections on schedule?
 *
 * This is the data a solicitor or insurer needs to see that the operator
 * was exercising reasonable care under BS EN 1176.
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

interface IncidentRow {
  readonly id: string;
  readonly org_id: string;
  readonly site_id: string;
  readonly asset_id: string | null;
  readonly defect_id: string | null;
  readonly incident_date: string;
  readonly incident_type: string;
  readonly severity: string;
  readonly description: string;
  readonly status: string;
  readonly [key: string]: unknown;
}

interface SiteRow {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly postcode: string | null;
  readonly local_authority: string | null;
  readonly status: string;
  readonly inspection_frequency_routine_days: number;
  readonly inspection_frequency_operational_days: number;
  readonly inspection_frequency_annual_days: number;
}

interface InspectionRow {
  readonly id: string;
  readonly inspection_date: string;
  readonly inspection_type: string;
  readonly status: string;
  readonly inspector_name: string;
  readonly overall_risk_rating: string | null;
  readonly total_defects: number;
  readonly total_assets_inspected: number;
}

interface DefectRow {
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
  readonly asset_code: string | null;
  readonly made_safe: boolean;
  readonly made_safe_at: string | null;
}

interface MakeSafeRow {
  readonly id: string;
  readonly defect_id: string;
  readonly action_type: string;
  readonly description: string;
  readonly performed_by_name: string;
  readonly performed_at: string;
}

interface AssetRow {
  readonly id: string;
  readonly asset_code: string;
  readonly asset_type: string;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly install_date: string | null;
  readonly last_inspection_date: string | null;
  readonly last_inspection_condition: string | null;
  readonly condition_trend: string | null;
  readonly is_active: boolean;
}

interface AssetConditionRow {
  readonly inspection_date: string;
  readonly overall_condition: string;
  readonly risk_rating: string | null;
  readonly inspector_name: string;
}

interface ComplianceGapRow {
  readonly inspection_type: string;
  readonly expected_frequency_days: number;
  readonly actual_gap_days: number;
  readonly inspection_date: string;
  readonly previous_date: string | null;
}

// =============================================
// GET CLAIMS PACK
// =============================================

export async function getClaimsPack(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const incidentId = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  // ── 1. Load incident ────────────
  const incidentRows = await db.rawQuery<IncidentRow>(
    `SELECT * FROM incidents WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [ctx.orgId, incidentId],
  );

  if (!incidentRows[0]) {
    throw new NotFoundError('Incident not found');
  }

  const incident = incidentRows[0];
  const siteId = incident.site_id;
  const assetId = incident.asset_id;
  const defectId = incident.defect_id;
  const incidentDate = incident.incident_date;

  // 12 months before incident = evidence window
  const windowStart = `${incidentDate}::date - INTERVAL '12 months'`;

  // ── Run all evidence queries in parallel ────────────
  const [
    siteRows,
    siteInspections,
    siteDefects,
    makeSafeActions,
    assetRows,
    assetConditionHistory,
    linkedDefectRows,
    complianceGaps,
  ] = await Promise.all([
    // ── 2. Site details ────────────
    db.rawQuery<SiteRow>(
      `SELECT id, name, address, postcode, local_authority, status,
              inspection_frequency_routine_days,
              inspection_frequency_operational_days,
              inspection_frequency_annual_days
       FROM sites WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [ctx.orgId, siteId],
    ),

    // ── 3. All inspections at this site in 12-month window ────────────
    db.rawQuery<InspectionRow>(
      `SELECT
        i.id,
        i.inspection_date::text AS inspection_date,
        i.inspection_type,
        i.status,
        COALESCE(u.first_name || ' ' || u.last_name, u.email, 'Unknown') AS inspector_name,
        i.overall_risk_rating,
        i.total_defects,
        i.total_assets_inspected
       FROM inspections i
       LEFT JOIN users u ON i.inspector_id = u.id
       WHERE i.org_id = $1
         AND i.site_id = $2
         AND i.inspection_date >= ($3::date - INTERVAL '12 months')
         AND i.inspection_date <= $3::date
         AND i.status != 'draft'
       ORDER BY i.inspection_date ASC`,
      [ctx.orgId, siteId, incidentDate],
    ),

    // ── 4. All defects at this site in 12-month window ────────────
    db.rawQuery<DefectRow>(
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
        a.asset_code,
        COALESCE(d.made_safe, false) AS made_safe,
        d.made_safe_at::text AS made_safe_at
       FROM defects d
       INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
       INNER JOIN inspections i ON ii.inspection_id = i.id
       LEFT JOIN assets a ON d.asset_id = a.id
       WHERE i.org_id = $1
         AND i.site_id = $2
         AND d.created_at >= ($3::date - INTERVAL '12 months')
         AND d.created_at <= ($3::date + INTERVAL '1 day')
       ORDER BY d.created_at ASC`,
      [ctx.orgId, siteId, incidentDate],
    ),

    // ── 5. Make-safe actions for defects at this site ────────────
    db.rawQuery<MakeSafeRow>(
      `SELECT
        msa.id,
        msa.defect_id,
        msa.action_type,
        msa.description,
        msa.performed_by_name,
        msa.performed_at::text AS performed_at
       FROM make_safe_actions msa
       INNER JOIN defects d ON msa.defect_id = d.id
       INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
       INNER JOIN inspections i ON ii.inspection_id = i.id
       WHERE i.org_id = $1
         AND i.site_id = $2
         AND msa.performed_at >= ($3::date - INTERVAL '12 months')
       ORDER BY msa.performed_at ASC`,
      [ctx.orgId, siteId, incidentDate],
    ),

    // ── 6. Linked asset details (if any) ────────────
    assetId
      ? db.rawQuery<AssetRow>(
          `SELECT a.id, a.asset_code, a.asset_type, a.manufacturer, a.model,
                  a.install_date::text AS install_date,
                  a.last_inspection_date::text AS last_inspection_date,
                  a.last_inspection_condition,
                  a.condition_trend,
                  a.is_active
           FROM assets a
           INNER JOIN sites s ON a.site_id = s.id
           WHERE s.org_id = $1 AND a.id = $2
           LIMIT 1`,
          [ctx.orgId, assetId],
        )
      : Promise.resolve([]),

    // ── 7. Asset condition history (if linked) ────────────
    assetId
      ? db.rawQuery<AssetConditionRow>(
          `SELECT
            i.inspection_date::text AS inspection_date,
            ii.overall_condition,
            ii.risk_rating,
            COALESCE(u.first_name || ' ' || u.last_name, u.email, 'Unknown') AS inspector_name
           FROM inspection_items ii
           INNER JOIN inspections i ON ii.inspection_id = i.id
           LEFT JOIN users u ON i.inspector_id = u.id
           WHERE i.org_id = $1
             AND ii.asset_id = $2
             AND i.status != 'draft'
             AND ii.overall_condition IS NOT NULL
           ORDER BY i.inspection_date ASC`,
          [ctx.orgId, assetId],
        )
      : Promise.resolve([]),

    // ── 8. Linked defect full details (if any) ────────────
    defectId
      ? db.rawQuery<DefectRow>(
          `SELECT
            d.id, d.description, d.severity, d.status,
            d.bs_en_reference, d.action_timeframe, d.remedial_action,
            d.due_date::text AS due_date,
            d.created_at::text AS created_at,
            d.resolved_at::text AS resolved_at,
            a.asset_code,
            COALESCE(d.made_safe, false) AS made_safe,
            d.made_safe_at::text AS made_safe_at
           FROM defects d
           INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
           INNER JOIN inspections i ON ii.inspection_id = i.id
           LEFT JOIN assets a ON d.asset_id = a.id
           WHERE i.org_id = $1 AND d.id = $2
           LIMIT 1`,
          [ctx.orgId, defectId],
        )
      : Promise.resolve([]),

    // ── 9. Compliance gaps — were inspections on schedule? ────────────
    db.rawQuery<ComplianceGapRow>(
      `WITH ordered_inspections AS (
        SELECT
          i.inspection_type,
          i.inspection_date,
          LAG(i.inspection_date) OVER (
            PARTITION BY i.inspection_type ORDER BY i.inspection_date
          ) AS previous_date
        FROM inspections i
        WHERE i.org_id = $1
          AND i.site_id = $2
          AND i.status != 'draft'
          AND i.inspection_date >= ($3::date - INTERVAL '12 months')
          AND i.inspection_date <= $3::date
      )
      SELECT
        oi.inspection_type,
        CASE oi.inspection_type
          WHEN 'routine_visual' THEN s.inspection_frequency_routine_days
          WHEN 'operational' THEN s.inspection_frequency_operational_days
          WHEN 'annual_main' THEN s.inspection_frequency_annual_days
          ELSE 0
        END AS expected_frequency_days,
        EXTRACT(DAY FROM oi.inspection_date - oi.previous_date)::int AS actual_gap_days,
        oi.inspection_date::text AS inspection_date,
        oi.previous_date::text AS previous_date
      FROM ordered_inspections oi
      INNER JOIN sites s ON s.id = $2
      WHERE oi.previous_date IS NOT NULL
      ORDER BY oi.inspection_date ASC`,
      [ctx.orgId, siteId, incidentDate],
    ),
  ]);

  const site = siteRows[0] ?? null;

  // ── Build compliance summary ────────────
  const totalInspectionsInWindow = siteInspections.length;
  const totalDefectsInWindow = siteDefects.length;
  const resolvedDefectsInWindow = siteDefects.filter((d) => d.status === 'resolved' || d.status === 'verified').length;
  const makeSafeCount = makeSafeActions.length;

  // Check for any gaps that exceeded the expected frequency
  const overdueGaps = complianceGaps.filter(
    (g) => g.actual_gap_days > g.expected_frequency_days && g.expected_frequency_days > 0,
  );

  const complianceSummary = {
    evidence_window: {
      from: new Date(new Date(incidentDate).getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      to: incidentDate,
    },
    total_inspections: totalInspectionsInWindow,
    total_defects_found: totalDefectsInWindow,
    defects_resolved: resolvedDefectsInWindow,
    defects_open_at_incident: totalDefectsInWindow - resolvedDefectsInWindow,
    make_safe_actions_taken: makeSafeCount,
    inspection_schedule_gaps: overdueGaps.length,
    schedule_compliance_percentage: complianceGaps.length > 0
      ? Math.round(((complianceGaps.length - overdueGaps.length) / complianceGaps.length) * 100)
      : 100,
    verdict: overdueGaps.length === 0
      ? 'All inspections were carried out within the required schedule during the evidence window.'
      : `${overdueGaps.length} inspection interval${overdueGaps.length !== 1 ? 's' : ''} exceeded the required schedule during the evidence window.`,
  };

  // ── Assemble claims pack ────────────
  return jsonResponse({
    success: true,
    data: {
      generated_at: new Date().toISOString(),
      generated_by: ctx.userName ?? 'Unknown',

      incident,
      site,

      linked_asset: assetRows[0] ?? null,
      linked_asset_condition_history: assetConditionHistory,
      linked_defect: linkedDefectRows[0] ?? null,

      site_inspections: siteInspections,
      site_defects: siteDefects,
      make_safe_actions: makeSafeActions,

      compliance_gaps: complianceGaps,
      compliance_summary: complianceSummary,
    },
  }, ctx.requestId);
}
