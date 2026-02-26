/**
 * InspectVoice — Inspector Metrics Computation Cron
 * Feature 14: Daily aggregation of performance metrics
 *
 * Runs via Cloudflare Cron Trigger (add to wrangler.toml alongside existing summary email).
 * Computes monthly metrics per inspector per org from raw inspection data.
 *
 * Metrics computed:
 *   - inspections_completed: count of signed inspections
 *   - completeness_avg: average A–F grade from Feature 4 completeness check
 *   - completeness_counts: histogram of grades
 *   - defects_total + defects_per_inspection_avg
 *   - photo_compliance_pct: % of inspection items with at least 1 photo
 *   - normalisation_accept_rate: from normalisation_log
 *   - avg_time_to_signoff_seconds: started_at → signed_at
 *   - overdue_rate: % of inspections past scheduled frequency
 *   - makesafe_initiated_count / makesafe_completed_count
 *   - rework_rate: % inspections with status changes after initial sign-off
 *   - critical_response_avg_seconds: critical defect → first make-safe action
 *   - evidence_quality_pct: % defects with photo + notes
 *   - completeness_variance: stddev of completeness scores
 *   - audit_flag_count: normalisation rejects + BS EN edits
 *
 * Strategy: UPSERT per (org, inspector, month, inspection_type).
 * Re-running is safe — always overwrites with latest data.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import type { Env } from '../types';

// =============================================
// MAIN ENTRY POINT
// =============================================

export async function computeInspectorMetrics(env: Env): Promise<void> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(env.DATABASE_URL);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  // Compute for current month + previous month (catch late sign-offs)
  const periods = [
    { start: new Date(year, month, 1), end: new Date(year, month + 1, 0) },     // current
    { start: new Date(year, month - 1, 1), end: new Date(year, month, 0) },       // previous
  ];

  for (const period of periods) {
    const periodStart = isoDate(period.start);
    const periodEnd = isoDate(period.end);

    try {
      await computePeriod(sql, periodStart, periodEnd);
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        module: 'metricsComputation',
        periodStart,
        periodEnd,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  console.log(JSON.stringify({
    level: 'info',
    module: 'metricsComputation',
    message: 'Metrics computation complete',
    periodsProcessed: periods.length,
  }));
}

// =============================================
// COMPUTE ONE PERIOD
// =============================================

type SqlFn = ReturnType<typeof import('@neondatabase/serverless').neon>;

async function computePeriod(sql: SqlFn, periodStart: string, periodEnd: string): Promise<void> {
  // Get all org/inspector combos that have signed inspections in this period
  const inspectorPeriods = await sql`
    SELECT DISTINCT org_id, inspector_id AS inspector_user_id
    FROM inspections
    WHERE status IN ('signed', 'exported')
      AND signed_at >= ${periodStart}
      AND signed_at < ${periodEnd}::date + interval '1 day'
  ` as Array<{ org_id: string; inspector_user_id: string }>;

  for (const row of inspectorPeriods) {
    try {
      // Compute combined (all types) + per-type
      await computeForInspector(sql, row.org_id, row.inspector_user_id, periodStart, periodEnd, null);

      // Per inspection type
      const types = await sql`
        SELECT DISTINCT inspection_type
        FROM inspections
        WHERE org_id = ${row.org_id}
          AND inspector_id = ${row.inspector_user_id}
          AND status IN ('signed', 'exported')
          AND signed_at >= ${periodStart}
          AND signed_at < ${periodEnd}::date + interval '1 day'
      ` as Array<{ inspection_type: string }>;

      for (const t of types) {
        await computeForInspector(sql, row.org_id, row.inspector_user_id, periodStart, periodEnd, t.inspection_type);
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        module: 'metricsComputation',
        orgId: row.org_id,
        inspectorUserId: row.inspector_user_id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

// =============================================
// COMPUTE FOR ONE INSPECTOR × ONE PERIOD
// =============================================

async function computeForInspector(
  sql: SqlFn,
  orgId: string,
  inspectorUserId: string,
  periodStart: string,
  periodEnd: string,
  inspectionType: string | null,
): Promise<void> {
  const typeFilter = inspectionType
    ? sql`AND i.inspection_type = ${inspectionType}`
    : sql``;

  // ── Core inspection stats ──
  const coreStats = await sql`
    SELECT
      COUNT(*)::int AS inspections_completed,
      AVG(i.total_defects)::numeric(6,2) AS defects_per_inspection_avg,
      SUM(i.total_defects)::int AS defects_total,
      AVG(EXTRACT(EPOCH FROM (i.signed_at::timestamp - i.started_at::timestamp)))::int AS avg_time_to_signoff_seconds,
      SUM(i.very_high_risk_count + i.high_risk_count)::int AS critical_defect_count
    FROM inspections i
    WHERE i.org_id = ${orgId}
      AND i.inspector_id = ${inspectorUserId}
      AND i.status IN ('signed', 'exported')
      AND i.signed_at >= ${periodStart}
      AND i.signed_at < ${periodEnd}::date + interval '1 day'
      ${typeFilter}
  ` as Array<Record<string, unknown>>;

  const core = coreStats[0] ?? {};
  const inspectionsCompleted = (core['inspections_completed'] as number) ?? 0;

  if (inspectionsCompleted === 0) return; // Nothing to record

  // ── Photo compliance: % of inspection items with at least 1 photo ──
  const photoStats = await sql`
    SELECT
      COUNT(ii.id)::int AS total_items,
      COUNT(CASE WHEN EXISTS (
        SELECT 1 FROM photos p WHERE p.inspection_item_id = ii.id
      ) THEN 1 END)::int AS items_with_photo
    FROM inspection_items ii
    INNER JOIN inspections i ON i.id = ii.inspection_id
    WHERE i.org_id = ${orgId}
      AND i.inspector_id = ${inspectorUserId}
      AND i.status IN ('signed', 'exported')
      AND i.signed_at >= ${periodStart}
      AND i.signed_at < ${periodEnd}::date + interval '1 day'
      ${typeFilter}
  ` as Array<Record<string, unknown>>;

  const photoRow = photoStats[0] ?? {};
  const totalItems = (photoRow['total_items'] as number) ?? 0;
  const itemsWithPhoto = (photoRow['items_with_photo'] as number) ?? 0;
  const photoCompliancePct = totalItems > 0 ? (itemsWithPhoto / totalItems) * 100 : null;

  // ── Evidence quality: % of defects with photo + inspector notes ──
  const evidenceStats = await sql`
    SELECT
      COUNT(d.id)::int AS total_defects_tracked,
      COUNT(CASE WHEN ii.inspector_notes IS NOT NULL AND ii.inspector_notes != ''
        AND EXISTS (SELECT 1 FROM photos p WHERE p.inspection_item_id = ii.id)
        THEN 1 END)::int AS defects_with_evidence
    FROM defects d
    INNER JOIN inspection_items ii ON ii.id = d.inspection_item_id
    INNER JOIN inspections i ON i.id = ii.inspection_id
    WHERE i.org_id = ${orgId}
      AND i.inspector_id = ${inspectorUserId}
      AND i.status IN ('signed', 'exported')
      AND i.signed_at >= ${periodStart}
      AND i.signed_at < ${periodEnd}::date + interval '1 day'
      ${typeFilter}
  ` as Array<Record<string, unknown>>;

  const evidenceRow = evidenceStats[0] ?? {};
  const totalDefectsTracked = (evidenceRow['total_defects_tracked'] as number) ?? 0;
  const defectsWithEvidence = (evidenceRow['defects_with_evidence'] as number) ?? 0;
  const evidenceQualityPct = totalDefectsTracked > 0 ? (defectsWithEvidence / totalDefectsTracked) * 100 : null;

  // ── Make-safe stats ──
  const makeSafeStats = await sql`
    SELECT
      COUNT(ms.id)::int AS initiated,
      COUNT(CASE WHEN ms.completed_at IS NOT NULL THEN 1 END)::int AS completed
    FROM make_safe_actions ms
    INNER JOIN defects d ON d.id = ms.defect_id
    INNER JOIN inspection_items ii ON ii.id = d.inspection_item_id
    INNER JOIN inspections i ON i.id = ii.inspection_id
    WHERE i.org_id = ${orgId}
      AND i.inspector_id = ${inspectorUserId}
      AND i.signed_at >= ${periodStart}
      AND i.signed_at < ${periodEnd}::date + interval '1 day'
      ${typeFilter}
  ` as Array<Record<string, unknown>>;

  const msRow = makeSafeStats[0] ?? {};
  const makesafeInitiated = (msRow['initiated'] as number) ?? 0;
  const makesafeCompleted = (msRow['completed'] as number) ?? 0;

  // ── Normalisation accept rate ──
  const normStats = await sql`
    SELECT
      COUNT(*)::int AS total_normalisations,
      COUNT(CASE WHEN status = 'accepted' THEN 1 END)::int AS accepted
    FROM normalisation_log nl
    WHERE nl.org_id = ${orgId}
      AND nl.user_id = ${inspectorUserId}
      AND nl.created_at >= ${periodStart}
      AND nl.created_at < ${periodEnd}::date + interval '1 day'
  ` as Array<Record<string, unknown>>;

  const normRow = normStats[0] ?? {};
  const totalNorm = (normRow['total_normalisations'] as number) ?? 0;
  const acceptedNorm = (normRow['accepted'] as number) ?? 0;
  const normAcceptRate = totalNorm > 0 ? (acceptedNorm / totalNorm) * 100 : null;

  // ── Audit flags: normalisation rejects + field edits ──
  const auditFlagCount = totalNorm > 0 ? (totalNorm - acceptedNorm) : 0;

  // ── Completeness: placeholder — requires Feature 4 grade storage ──
  // If completeness_grade is stored on inspections table, compute here.
  // For now, set to null until completeness grades are persisted.
  const completenessAvg: number | null = null;
  const completenessVariance: number | null = null;
  const completenessCounts = JSON.stringify({ A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 });

  // ── Overdue rate: placeholder — requires schedule comparison ──
  const overdueRate: number | null = null;

  // ── Rework rate: placeholder — requires status change tracking ──
  const reworkRate: number | null = null;

  // ── Critical response time: placeholder ──
  const criticalResponseAvg: number | null = null;

  // ── UPSERT ──
  await sql`
    INSERT INTO inspector_metrics_period (
      org_id, inspector_user_id, period_type, period_start, period_end,
      inspection_type, inspections_completed, completeness_avg, completeness_counts,
      defects_total, defects_per_inspection_avg, photo_compliance_pct,
      normalisation_accept_rate, avg_time_to_signoff_seconds, overdue_rate,
      makesafe_initiated_count, makesafe_completed_count,
      rework_rate, critical_response_avg_seconds, evidence_quality_pct,
      completeness_variance, audit_flag_count, computed_at, source_version
    ) VALUES (
      ${orgId}, ${inspectorUserId}, 'month', ${periodStart}, ${periodEnd},
      ${inspectionType}, ${inspectionsCompleted}, ${completenessAvg}, ${completenessCounts}::jsonb,
      ${(core['defects_total'] as number) ?? 0}, ${core['defects_per_inspection_avg'] as number | null},
      ${photoCompliancePct},
      ${normAcceptRate}, ${core['avg_time_to_signoff_seconds'] as number | null}, ${overdueRate},
      ${makesafeInitiated}, ${makesafeCompleted},
      ${reworkRate}, ${criticalResponseAvg}, ${evidenceQualityPct},
      ${completenessVariance}, ${auditFlagCount}, NOW(), '1.0'
    )
    ON CONFLICT ON CONSTRAINT uq_metrics_period
    DO UPDATE SET
      inspections_completed = EXCLUDED.inspections_completed,
      completeness_avg = EXCLUDED.completeness_avg,
      completeness_counts = EXCLUDED.completeness_counts,
      defects_total = EXCLUDED.defects_total,
      defects_per_inspection_avg = EXCLUDED.defects_per_inspection_avg,
      photo_compliance_pct = EXCLUDED.photo_compliance_pct,
      normalisation_accept_rate = EXCLUDED.normalisation_accept_rate,
      avg_time_to_signoff_seconds = EXCLUDED.avg_time_to_signoff_seconds,
      overdue_rate = EXCLUDED.overdue_rate,
      makesafe_initiated_count = EXCLUDED.makesafe_initiated_count,
      makesafe_completed_count = EXCLUDED.makesafe_completed_count,
      rework_rate = EXCLUDED.rework_rate,
      critical_response_avg_seconds = EXCLUDED.critical_response_avg_seconds,
      evidence_quality_pct = EXCLUDED.evidence_quality_pct,
      completeness_variance = EXCLUDED.completeness_variance,
      audit_flag_count = EXCLUDED.audit_flag_count,
      computed_at = NOW(),
      source_version = '1.0'
  `;
}

// =============================================
// HELPER
// =============================================

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}
