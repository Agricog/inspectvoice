/**
 * InspectVoice — Inspector Performance Route Handlers
 * Feature 14: Performance & Quality Insights
 *
 * Routes:
 *   GET    /api/v1/inspector-performance              → org overview table (manager/admin)
 *   GET    /api/v1/inspector-performance/:userId       → inspector detail + trends (manager/admin)
 *   GET    /api/v1/my-performance                      → current user's own stats (all members)
 *   GET    /api/v1/my-performance/trends               → current user's trend data (all members)
 *   POST   /api/v1/inspector-performance/:userId/share → generate "Your Month" link (manager/admin)
 *   GET    /api/v1/performance-share/:token            → resolve shared link (scoped, no auth)
 *   GET    /api/v1/inspector-performance/benchmarks     → anonymised benchmark bands (all members)
 *
 * RBAC:
 *   - org:admin + org:manager: full org-wide access
 *   - org:member: own stats only via /my-performance
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import type { RequestContext, RouteParams } from '../types';
import { formatErrorResponse } from '../shared/errors';
import { Logger } from '../shared/logger';

// =============================================
// HELPERS
// =============================================

function json<T>(data: T, requestId: string, status = 200): Response {
  return new Response(
    JSON.stringify({ success: true, data, requestId }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function forbidden(requestId: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions', requestId } }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
}

function isManagerOrAdmin(role: string): boolean {
  return role === 'admin' || role === 'org:admin' || role === 'manager' || role === 'org:manager';
}

async function query(ctx: RequestContext, sql: string, params: unknown[] = []): Promise<unknown[]> {
  const { neon } = await import('@neondatabase/serverless');
  const sql_fn = neon(ctx.env.DATABASE_URL);
  return sql_fn(sql, params) as Promise<unknown[]>;
}

/** Parse period preset into date range */
function resolvePeriodRange(
  preset: string | null,
  customStart: string | null,
  customEnd: string | null,
): { start: string; end: string; periodType: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (preset) {
    case 'last_7_days': {
      const end = new Date(now);
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { start: isoDate(start), end: isoDate(end), periodType: 'day' };
    }
    case 'quarter': {
      const qStart = new Date(year, Math.floor(month / 3) * 3, 1);
      return { start: isoDate(qStart), end: isoDate(now), periodType: 'month' };
    }
    case 'ytd': {
      return { start: `${year}-01-01`, end: isoDate(now), periodType: 'month' };
    }
    case 'rolling_90': {
      const start = new Date(now);
      start.setDate(start.getDate() - 90);
      return { start: isoDate(start), end: isoDate(now), periodType: 'month' };
    }
    case 'custom': {
      if (customStart && customEnd) {
        return { start: customStart, end: customEnd, periodType: 'month' };
      }
      // Fall through to month default
    }
    // eslint-disable-next-line no-fallthrough
    case 'month':
    default: {
      const monthStart = new Date(year, month, 1);
      return { start: isoDate(monthStart), end: isoDate(now), periodType: 'month' };
    }
  }
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

// =============================================
// ORG OVERVIEW TABLE (manager/admin)
// GET /api/v1/inspector-performance
// =============================================

export async function getPerformanceOverview(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    if (!isManagerOrAdmin(ctx.userRole)) return forbidden(ctx.requestId);

    const url = new URL(request.url);
    const period = url.searchParams.get('period') ?? 'month';
    const customStart = url.searchParams.get('period_start');
    const customEnd = url.searchParams.get('period_end');
    const inspectionType = url.searchParams.get('inspection_type');

    const { start, end } = resolvePeriodRange(period, customStart, customEnd);

    // Aggregate across all periods in the range per inspector
    const sql = `
      SELECT
        m.inspector_user_id,
        COALESCE(u.first_name || ' ' || u.last_name, u.email, m.inspector_user_id) AS inspector_name,
        COALESCE(u.email, '') AS inspector_email,
        SUM(m.inspections_completed)::int AS inspections_completed,
        AVG(m.completeness_avg)::numeric(5,2) AS completeness_avg,
        AVG(m.overdue_rate)::numeric(5,2) AS overdue_rate,
        AVG(m.avg_time_to_signoff_seconds)::int AS avg_time_to_signoff_seconds,
        AVG(m.photo_compliance_pct)::numeric(5,2) AS photo_compliance_pct,
        AVG(m.evidence_quality_pct)::numeric(5,2) AS evidence_quality_pct,
        SUM(m.makesafe_initiated_count)::int AS makesafe_initiated_count,
        SUM(m.makesafe_completed_count)::int AS makesafe_completed_count,
        AVG(m.rework_rate)::numeric(5,2) AS rework_rate,
        SUM(m.audit_flag_count)::int AS audit_flag_count
      FROM inspector_metrics_period m
      LEFT JOIN users u ON u.id = m.inspector_user_id AND u.org_id = m.org_id
      WHERE m.org_id = $1
        AND m.period_start >= $2
        AND m.period_end <= $3
        AND m.period_type IN ('day', 'month')
        ${inspectionType ? 'AND (m.inspection_type = $4 OR m.inspection_type IS NULL)' : 'AND m.inspection_type IS NULL'}
      GROUP BY m.inspector_user_id, u.first_name, u.last_name, u.email
      ORDER BY inspections_completed DESC
    `;

    const params: unknown[] = [ctx.orgId, start, end];
    if (inspectionType) params.push(inspectionType);

    const rows = await query(ctx, sql, params) as Array<Record<string, unknown>>;

    return json({ period: { start, end, preset: period }, inspectors: rows }, ctx.requestId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// INSPECTOR DETAIL (manager/admin)
// GET /api/v1/inspector-performance/:userId
// =============================================

export async function getPerformanceDetail(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    if (!isManagerOrAdmin(ctx.userRole)) return forbidden(ctx.requestId);

    const inspectorUserId = params['userId'] ?? '';
    return fetchInspectorDetail(request, ctx, inspectorUserId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// MY PERFORMANCE (current user)
// GET /api/v1/my-performance
// =============================================

export async function getMyPerformance(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    return fetchInspectorDetail(request, ctx, ctx.userId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// MY PERFORMANCE TRENDS (current user)
// GET /api/v1/my-performance/trends
// =============================================

export async function getMyPerformanceTrends(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    return fetchInspectorTrends(request, ctx, ctx.userId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// SHARED DETAIL FETCHER
// =============================================

async function fetchInspectorDetail(
  request: Request,
  ctx: RequestContext,
  inspectorUserId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const period = url.searchParams.get('period') ?? 'month';
  const customStart = url.searchParams.get('period_start');
  const customEnd = url.searchParams.get('period_end');

  const { start, end } = resolvePeriodRange(period, customStart, customEnd);

  // Current period aggregate (all types combined)
  const currentSql = `
    SELECT *
    FROM inspector_metrics_period
    WHERE org_id = $1
      AND inspector_user_id = $2
      AND period_start >= $3
      AND period_end <= $4
      AND inspection_type IS NULL
      AND period_type = 'month'
    ORDER BY period_start DESC
    LIMIT 1
  `;
  const currentRows = await query(ctx, currentSql, [ctx.orgId, inspectorUserId, start, end]) as Array<Record<string, unknown>>;

  // By inspection type breakdown
  const byTypeSql = `
    SELECT *
    FROM inspector_metrics_period
    WHERE org_id = $1
      AND inspector_user_id = $2
      AND period_start >= $3
      AND period_end <= $4
      AND inspection_type IS NOT NULL
      AND period_type = 'month'
    ORDER BY inspection_type ASC
  `;
  const byTypeRows = await query(ctx, byTypeSql, [ctx.orgId, inspectorUserId, start, end]) as Array<Record<string, unknown>>;

  // Inspector name
  const userRows = await query(ctx, `
    SELECT COALESCE(first_name || ' ' || last_name, email, $2) AS name
    FROM users WHERE id = $2 AND org_id = $1
  `, [ctx.orgId, inspectorUserId]) as Array<Record<string, unknown>>;

  const inspectorName = (userRows[0]?.['name'] as string) ?? inspectorUserId;

  return json({
    inspector_user_id: inspectorUserId,
    inspector_name: inspectorName,
    period: { start, end, preset: period },
    current: currentRows[0] ?? null,
    by_inspection_type: byTypeRows,
  }, ctx.requestId);
}

// =============================================
// TREND DATA FETCHER
// =============================================

async function fetchInspectorTrends(
  request: Request,
  ctx: RequestContext,
  inspectorUserId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const months = Math.min(parseInt(url.searchParams.get('months') ?? '6', 10), 24);

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  const sql = `
    SELECT
      period_start,
      inspections_completed,
      completeness_avg,
      defects_per_inspection_avg,
      photo_compliance_pct,
      overdue_rate,
      avg_time_to_signoff_seconds,
      evidence_quality_pct,
      rework_rate,
      makesafe_initiated_count,
      audit_flag_count
    FROM inspector_metrics_period
    WHERE org_id = $1
      AND inspector_user_id = $2
      AND period_type = 'month'
      AND inspection_type IS NULL
      AND period_start >= $3
    ORDER BY period_start ASC
  `;

  const rows = await query(ctx, sql, [ctx.orgId, inspectorUserId, isoDate(startDate)]) as Array<Record<string, unknown>>;

  // Build trend series for key metrics
  const metricKeys = [
    { key: 'inspections_completed', label: 'Inspections Completed', unit: 'count' },
    { key: 'completeness_avg', label: 'Completeness Grade', unit: '%' },
    { key: 'defects_per_inspection_avg', label: 'Defects per Inspection', unit: 'count' },
    { key: 'photo_compliance_pct', label: 'Photo Compliance', unit: '%' },
    { key: 'overdue_rate', label: 'Overdue Rate', unit: '%' },
    { key: 'evidence_quality_pct', label: 'Evidence Quality', unit: '%' },
    { key: 'rework_rate', label: 'Rework Rate', unit: '%' },
  ];

  const trends = metricKeys.map((mk) => {
    const dataPoints = rows.map((r) => ({
      period_start: r['period_start'] as string,
      value: r[mk.key] as number | null,
    }));

    const values = dataPoints.map((dp) => dp.value).filter((v): v is number => v !== null);
    const current = values.length > 0 ? values[values.length - 1]! : null;
    const previous = values.length > 1 ? values[values.length - 2]! : null;

    let direction: 'improving' | 'stable' | 'declining' = 'stable';
    if (current !== null && previous !== null) {
      const diff = current - previous;
      const threshold = Math.abs(previous) * 0.05 || 1;
      // For overdue_rate and rework_rate, lower is better
      const lowerIsBetter = mk.key === 'overdue_rate' || mk.key === 'rework_rate';
      if (Math.abs(diff) > threshold) {
        const isUp = diff > 0;
        direction = (isUp && !lowerIsBetter) || (!isUp && lowerIsBetter) ? 'improving' : 'declining';
      }
    }

    return {
      metric_key: mk.key,
      label: mk.label,
      unit: mk.unit,
      direction,
      current_value: current,
      previous_value: previous,
      data_points: dataPoints,
    };
  });

  return json({ inspector_user_id: inspectorUserId, trends }, ctx.requestId);
}

// =============================================
// BENCHMARK BANDS (anonymised, all members)
// GET /api/v1/inspector-performance/benchmarks
// =============================================

export async function getPerformanceBenchmarks(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const period = url.searchParams.get('period') ?? 'month';
    const customStart = url.searchParams.get('period_start');
    const customEnd = url.searchParams.get('period_end');

    const { start, end } = resolvePeriodRange(period, customStart, customEnd);

    const metricColumns = [
      'completeness_avg',
      'defects_per_inspection_avg',
      'photo_compliance_pct',
      'overdue_rate',
      'evidence_quality_pct',
      'rework_rate',
    ];

    const bands: Array<Record<string, unknown>> = [];

    for (const col of metricColumns) {
      const sql = `
        SELECT
          percentile_cont(0.75) WITHIN GROUP (ORDER BY agg.val) AS top_25,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY agg.val) AS median,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY agg.val) AS bottom_25
        FROM (
          SELECT AVG(${col})::numeric AS val
          FROM inspector_metrics_period
          WHERE org_id = $1
            AND period_start >= $2
            AND period_end <= $3
            AND period_type IN ('day', 'month')
            AND inspection_type IS NULL
          GROUP BY inspector_user_id
          HAVING AVG(${col}) IS NOT NULL
        ) agg
      `;

      const statRows = await query(ctx, sql, [ctx.orgId, start, end]) as Array<Record<string, unknown>>;
      const stats = statRows[0];

      // Get current user's value
      const userSql = `
        SELECT AVG(${col})::numeric AS val
        FROM inspector_metrics_period
        WHERE org_id = $1
          AND inspector_user_id = $2
          AND period_start >= $3
          AND period_end <= $4
          AND period_type IN ('day', 'month')
          AND inspection_type IS NULL
      `;
      const userRows = await query(ctx, userSql, [ctx.orgId, ctx.userId, start, end]) as Array<Record<string, unknown>>;
      const inspectorValue = userRows[0]?.['val'] as number | null;

      const top25 = stats?.['top_25'] as number | null;
      const median = stats?.['median'] as number | null;
      const bottom25 = stats?.['bottom_25'] as number | null;

      let band: 'top' | 'middle' | 'bottom' = 'middle';
      if (inspectorValue !== null && top25 !== null && bottom25 !== null) {
        if (inspectorValue >= top25) band = 'top';
        else if (inspectorValue <= bottom25) band = 'bottom';
      }

      bands.push({
        metric_key: col,
        top_25: top25,
        median,
        bottom_25: bottom25,
        inspector_value: inspectorValue,
        band,
      });
    }

    return json({ period: { start, end, preset: period }, bands }, ctx.requestId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// GENERATE SHARE LINK (manager/admin)
// POST /api/v1/inspector-performance/:userId/share
// =============================================

export async function createPerformanceShareLink(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    if (!isManagerOrAdmin(ctx.userRole)) return forbidden(ctx.requestId);

    const inspectorUserId = params['userId'] ?? '';
    const body = await request.json() as Record<string, unknown>;
    const periodStart = body['period_start'] as string;
    const periodEnd = body['period_end'] as string;

    if (!periodStart || !periodEnd) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'period_start and period_end required', requestId: ctx.requestId } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Generate token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    // Hash for storage
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
    const tokenHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    // Expires in 30 days
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await query(ctx, `
      INSERT INTO performance_share_links
        (org_id, inspector_user_id, period_start, period_end, token_hash, expires_at, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [ctx.orgId, inspectorUserId, periodStart, periodEnd, tokenHash, expiresAt.toISOString(), ctx.userId]);

    const logger = Logger.fromContext(ctx);
    logger.info('Performance share link created', { inspectorUserId, periodStart, periodEnd });

    return json({
      token,
      inspector_user_id: inspectorUserId,
      period_start: periodStart,
      period_end: periodEnd,
      expires_at: expiresAt.toISOString(),
      url: `/performance-share/${token}`,
    }, ctx.requestId, 201);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// RESOLVE SHARE LINK (public, scoped)
// GET /api/v1/performance-share/:token
// =============================================

export async function resolvePerformanceShareLink(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    const token = params['token'] ?? '';

    // Hash the provided token
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
    const tokenHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const linkRows = await query(ctx, `
      SELECT org_id, inspector_user_id, period_start, period_end, expires_at
      FROM performance_share_links
      WHERE token_hash = $1
    `, [tokenHash]) as Array<Record<string, unknown>>;

    if (linkRows.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Invalid or expired link', requestId: ctx.requestId } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const link = linkRows[0]!;
    const expiresAt = new Date(link['expires_at'] as string);
    if (expiresAt < new Date()) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'EXPIRED', message: 'This link has expired', requestId: ctx.requestId } }),
        { status: 410, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const orgId = link['org_id'] as string;
    const inspectorUserId = link['inspector_user_id'] as string;
    const periodStart = link['period_start'] as string;
    const periodEnd = link['period_end'] as string;

    // Fetch scoped data — only this inspector's metrics for the given period
    const metricsSql = `
      SELECT *
      FROM inspector_metrics_period
      WHERE org_id = $1
        AND inspector_user_id = $2
        AND period_start >= $3
        AND period_end <= $4
        AND inspection_type IS NULL
        AND period_type = 'month'
      ORDER BY period_start ASC
    `;
    const metricsRows = await query(ctx, metricsSql, [orgId, inspectorUserId, periodStart, periodEnd]) as Array<Record<string, unknown>>;

    // Inspector name
    const userRows = await query(ctx, `
      SELECT COALESCE(first_name || ' ' || last_name, email) AS name
      FROM users WHERE id = $1 AND org_id = $2
    `, [inspectorUserId, orgId]) as Array<Record<string, unknown>>;

    return json({
      inspector_name: (userRows[0]?.['name'] as string) ?? 'Inspector',
      period_start: periodStart,
      period_end: periodEnd,
      metrics: metricsRows,
    }, ctx.requestId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}
