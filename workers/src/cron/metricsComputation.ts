/**
 * InspectVoice — Inspector Metrics Computation Cron
 * Feature 14: Daily aggregation of performance metrics
 *
 * Runs via Cloudflare Cron Trigger at 03:00 UTC daily.
 * Also callable via POST /api/v1/inspector-performance/compute (admin only).
 *
 * Computes monthly metrics per inspector per org from raw inspection data.
 * Strategy: DELETE + INSERT per (org, inspector, month, inspection_type).
 * Re-running is safe — always replaces with latest data.
 *
 * FIX: 4 Mar 2026
 *   - Replaced tagged template SQL composition with parameterised string queries.
 *     Neon's tagged template driver does NOT support fragment composition.
 *   - Changed UPSERT to DELETE+INSERT because PostgreSQL UNIQUE constraints
 *     treat NULL as always distinct — ON CONFLICT never fires when
 *     inspection_type IS NULL, causing duplicate rows on every run.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import type { Env } from '../types';

// =============================================
// TYPES
// =============================================

type SqlFn = (query: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;

// =============================================
// MAIN ENTRY POINT
// =============================================

export async function computeInspectorMetrics(env: Env): Promise<void> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(env.DATABASE_URL) as unknown as SqlFn;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  // Compute for current month + previous month (catch late sign-offs)
  const periods = [
    { start: new Date(year, month, 1), end: new Date(year, month + 1, 0) },     // current
    { start: new Date(year, month - 1, 1), end: new Date(year, month, 0) },       // previous
  ];

  let totalInserted = 0;
  let totalErrors = 0;

  for (const period of periods) {
    const periodStart = isoDate(period.start);
    const periodEnd = isoDate(period.end);

    try {
      const count = await computePeriod(sql, periodStart, periodEnd);
      totalInserted += count;
    } catch (error) {
      totalErrors++;
      console.error(JSON.stringify({
        level: 'error',
        module: 'metricsComputation',
        periodStart,
        periodEnd,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }));
    }
  }

  console.log(JSON.stringify({
    level: 'info',
    module: 'metricsComputation',
    message: 'Metrics computation complete',
    periodsProcessed: periods.length,
    totalInserted,
    totalErrors,
  }));
}

// =============================================
// COMPUTE ONE PERIOD
// =============================================

async function computePeriod(sql: SqlFn, periodStart: string, periodEnd: string): Promise<number> {
  // Get all org/inspector combos that have signed inspections in this period
  const inspectorPeriods = await sql(
    `SELECT DISTINCT org_id, inspector_id AS inspector_user_id
     FROM inspections
     WHERE status IN ('signed', 'exported')
       AND signed_at >= $1
       AND signed_at < $2::date + interval '1 day'`,
    [periodStart, periodEnd],
  );

  let insertCount = 0;

  for (const row of inspectorPeriods) {
    const orgId = row['org_id'] as string;
    const inspectorUserId = row['inspector_user_id'] as string;

    try {
      // Compute combined (all types)
      await computeForInspector(sql, orgId, inspectorUserId, periodStart, periodEnd, null);
      insertCount++;

      // Per inspection type
      const types = await sql(
        `SELECT DISTINCT inspection_type
         FROM inspections
         WHERE org_id = $1
           AND inspector_id = $2
           AND status IN ('signed', 'exported')
           AND signed_at >= $3
           AND signed_at < $4::date + interval '1 day'`,
        [orgId, inspectorUserId, periodStart, periodEnd],
      );

      for (const t of types) {
        const inspType = t['inspection_type'] as string;
        if (inspType) {
          await computeForInspector(sql, orgId, inspectorUserId, periodStart, periodEnd, inspType);
          insertCount++;
        }
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        module: 'metricsComputation',
        orgId,
        inspectorUserId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }));
    }
  }

  return insertCount;
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
  // Build conditional type filter
  const baseParams = [orgId, inspectorUserId, periodStart, periodEnd];
  const typeClause = inspectionType
    ? 'AND i.inspection_type = $5'
    : '';
  const params = inspectionType
    ? [...baseParams, inspectionType]
    : baseParams;

  // ── Core inspection stats ──
  const coreStats = await sql(
    `SELECT
       COUNT(*)::int AS inspections_completed,
       AVG(i.total_defects)::numeric(6,2) AS defects_per_inspection_avg,
       SUM(i.total_defects)::int AS defects_total,
       AVG(EXTRACT(EPOCH FROM (i.signed_at::timestamp - i.started_at::timestamp)))::int AS avg_time_to_signoff_seconds
     FROM inspections i
     WHERE i.org_id = $1
       AND i.inspector_id = $2
       AND i.status IN ('signed', 'exported')
       AND i.signed_at >= $3
       AND i.signed_at < $4::date + interval '1 day'
       ${typeClause}`,
    params,
  );

  const core = coreStats[0] ?? {};
  const inspectionsCompleted = (core['inspections_completed'] as number) ?? 0;

  if (inspectionsCompleted === 0) return; // Nothing to record

  // ── Photo compliance: % of inspection items with at least 1 photo ──
  const photoStats = await sql(
    `SELECT
       COUNT(ii.id)::int AS total_items,
       COUNT(CASE WHEN EXISTS (
         SELECT 1 FROM photos p WHERE p.inspection_item_id = ii.id
       ) THEN 1 END)::int AS items_with_photo
     FROM inspection_items ii
     INNER JOIN inspections i ON i.id = ii.inspection_id
     WHERE i.org_id = $1
       AND i.inspector_id = $2
       AND i.status IN ('signed', 'exported')
       AND i.signed_at >= $3
       AND i.signed_at < $4::date + interval '1 day'
       ${typeClause}`,
    params,
  );

  const photoRow = photoStats[0] ?? {};
  const totalItems = (photoRow['total_items'] as number) ?? 0;
  const itemsWithPhoto = (photoRow['items_with_photo'] as number) ?? 0;
  const photoCompliancePct = totalItems > 0
    ? Math.round((itemsWithPhoto / totalItems) * 10000) / 100
    : null;

  // ── Evidence quality: % of defects with photo + inspector notes ──
  const evidenceStats = await sql(
    `SELECT
       COUNT(d.id)::int AS total_defects_tracked,
       COUNT(CASE WHEN ii.inspector_notes IS NOT NULL AND ii.inspector_notes != ''
         AND EXISTS (SELECT 1 FROM photos p WHERE p.inspection_item_id = ii.id)
         THEN 1 END)::int AS defects_with_evidence
     FROM defects d
     INNER JOIN inspection_items ii ON ii.id = d.inspection_item_id
     INNER JOIN inspections i ON i.id = ii.inspection_id
     WHERE i.org_id = $1
       AND i.inspector_id = $2
       AND i.status IN ('signed', 'exported')
       AND i.signed_at >= $3
       AND i.signed_at < $4::date + interval '1 day'
       ${typeClause}`,
    params,
  );

  const evidenceRow = evidenceStats[0] ?? {};
  const totalDefectsTracked = (evidenceRow['total_defects_tracked'] as number) ?? 0;
  const defectsWithEvidence = (evidenceRow['defects_with_evidence'] as number) ?? 0;
  const evidenceQualityPct = totalDefectsTracked > 0
    ? Math.round((defectsWithEvidence / totalDefectsTracked) * 10000) / 100
    : null;

  // ── Make-safe stats ──
  const makeSafeStats = await sql(
    `SELECT
       COUNT(ms.id)::int AS initiated,
       COUNT(CASE WHEN ms.asset_closed = true THEN 1 END)::int AS completed
     FROM make_safe_actions ms
     INNER JOIN defects d ON d.id = ms.defect_id
     INNER JOIN inspection_items ii ON ii.id = d.inspection_item_id
     INNER JOIN inspections i ON i.id = ii.inspection_id
     WHERE i.org_id = $1
       AND i.inspector_id = $2
       AND i.signed_at >= $3
       AND i.signed_at < $4::date + interval '1 day'
       ${typeClause}`,
    params,
  );

  const msRow = makeSafeStats[0] ?? {};
  const makesafeInitiated = (msRow['initiated'] as number) ?? 0;
  const makesafeCompleted = (msRow['completed'] as number) ?? 0;

  // ── Normalisation accept rate ──
  // Uses separate params (no inspection_type filter — normalisation is per-user)
  const normStats = await sql(
    `SELECT
       COUNT(*)::int AS total_normalisations,
       COUNT(CASE WHEN status = 'accepted' THEN 1 END)::int AS accepted
     FROM normalisation_log
     WHERE org_id = $1
       AND requested_by = $2
       AND created_at >= $3
       AND created_at < $4::date + interval '1 day'`,
    [orgId, inspectorUserId, periodStart, periodEnd],
  );

  const normRow = normStats[0] ?? {};
  const totalNorm = (normRow['total_normalisations'] as number) ?? 0;
  const acceptedNorm = (normRow['accepted'] as number) ?? 0;
  const normAcceptRate = totalNorm > 0
    ? Math.round((acceptedNorm / totalNorm) * 10000) / 100
    : null;

  // ── Audit flags: normalisation rejects ──
  const auditFlagCount = totalNorm > 0 ? (totalNorm - acceptedNorm) : 0;

  // ── Overdue rate: % of inspections completed past their scheduled due date ──
  // Compare inspection_date against the site's frequency schedule
  const overdueStats = await sql(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(CASE
         WHEN i.inspection_date > (
           SELECT MAX(prev.inspection_date) + (
             CASE i.inspection_type
               WHEN 'routine_visual' THEN COALESCE(s.inspection_frequency_routine_days, 7)
               WHEN 'operational' THEN COALESCE(s.inspection_frequency_operational_days, 90)
               WHEN 'annual_main' THEN COALESCE(s.inspection_frequency_annual_days, 365)
               ELSE 365
             END * interval '1 day'
           )
           FROM inspections prev
           WHERE prev.site_id = i.site_id
             AND prev.inspection_type = i.inspection_type
             AND prev.status IN ('signed', 'exported')
             AND prev.signed_at < i.signed_at
         ) THEN 1
       END)::int AS overdue
     FROM inspections i
     INNER JOIN sites s ON s.id = i.site_id
     WHERE i.org_id = $1
       AND i.inspector_id = $2
       AND i.status IN ('signed', 'exported')
       AND i.signed_at >= $3
       AND i.signed_at < $4::date + interval '1 day'
       ${typeClause}`,
    params,
  );

  const overdueRow = overdueStats[0] ?? {};
  const overdueTotal = (overdueRow['total'] as number) ?? 0;
  const overdueCount = (overdueRow['overdue'] as number) ?? 0;
  const overdueRate = overdueTotal > 0
    ? Math.round((overdueCount / overdueTotal) * 10000) / 100
    : null;

  // ── Completeness: placeholder until Feature 4 grades are persisted ──
  const completenessAvg: number | null = null;
  const completenessVariance: number | null = null;
  const completenessCounts = '{}';

  // ── Rework rate: placeholder until status change tracking is added ──
  const reworkRate: number | null = null;

  // ── Critical response time: placeholder ──
  const criticalResponseAvg: number | null = null;

  // ── DELETE then INSERT ──
  // PostgreSQL UNIQUE constraints treat NULL as always distinct,
  // so ON CONFLICT never fires when inspection_type IS NULL.
  // We use explicit DELETE + INSERT to avoid duplicate rows.
  if (inspectionType) {
    await sql(
      `DELETE FROM inspector_metrics_period
       WHERE org_id = $1 AND inspector_user_id = $2
         AND period_type = 'month' AND period_start = $3
         AND inspection_type = $4`,
      [orgId, inspectorUserId, periodStart, inspectionType],
    );
  } else {
    await sql(
      `DELETE FROM inspector_metrics_period
       WHERE org_id = $1 AND inspector_user_id = $2
         AND period_type = 'month' AND period_start = $3
         AND inspection_type IS NULL`,
      [orgId, inspectorUserId, periodStart],
    );
  }

  await sql(
    `INSERT INTO inspector_metrics_period (
       org_id, inspector_user_id, period_type, period_start, period_end,
       inspection_type, inspections_completed, completeness_avg, completeness_counts,
       defects_total, defects_per_inspection_avg, photo_compliance_pct,
       normalisation_accept_rate, avg_time_to_signoff_seconds, overdue_rate,
       makesafe_initiated_count, makesafe_completed_count,
       rework_rate, critical_response_avg_seconds, evidence_quality_pct,
       completeness_variance, audit_flag_count, computed_at, source_version
     ) VALUES (
       $1, $2, 'month', $3, $4,
       $5, $6, $7, $8::jsonb,
       $9, $10, $11,
       $12, $13, $14,
       $15, $16,
       $17, $18, $19,
       $20, $21, NOW(), '1.2'
     )`,
    [
      orgId,                                                        // $1
      inspectorUserId,                                              // $2
      periodStart,                                                  // $3
      periodEnd,                                                    // $4
      inspectionType,                                               // $5
      inspectionsCompleted,                                         // $6
      completenessAvg,                                              // $7
      completenessCounts,                                           // $8
      (core['defects_total'] as number) ?? 0,                       // $9
      (core['defects_per_inspection_avg'] as number | null) ?? null,// $10
      photoCompliancePct,                                           // $11
      normAcceptRate,                                               // $12
      (core['avg_time_to_signoff_seconds'] as number | null) ?? null, // $13
      overdueRate,                                                  // $14
      makesafeInitiated,                                            // $15
      makesafeCompleted,                                            // $16
      reworkRate,                                                   // $17
      criticalResponseAvg,                                          // $18
      evidenceQualityPct,                                           // $19
      completenessVariance,                                         // $20
      auditFlagCount,                                               // $21
    ],
  );
}

// =============================================
// HELPER
// =============================================

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}
