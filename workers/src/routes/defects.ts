/**
 * InspectVoice — Defects Route Handler
 * CRUD endpoints for defect tracking and resolution workflow.
 *
 * Endpoints:
 *   GET    /api/v1/defects           — List defects (paginated, filterable by status/severity/site)
 *   GET    /api/v1/defects/:id       — Get defect detail
 *   PUT    /api/v1/defects/:id       — Update defect (assign, resolve, defer, verify)
 *
 * Defects are created by the AI pipeline (not directly by users).
 * Users manage defects through assignment and resolution workflows.
 *
 * Defect lifecycle:
 *   OPEN → ASSIGNED → IN_PROGRESS → RESOLVED → VERIFIED
 *                  ↘ DEFERRED (with reason and review date)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { writeAuditLog, buildChanges } from '../services/audit';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { NotFoundError, BadRequestError } from '../shared/errors';
import {
  parseJsonBody,
  validateUUID,
  validateOptionalString,
  validateOptionalEnum,
  validateOptionalISODate,
  validateOptionalCostGbp,
} from '../shared/validation';
import {
  parsePagination,
  buildPaginationMeta,
  paginationToOffset,
  parseSortField,
  parseSortDirection,
  parseFilterParam,
} from '../shared/pagination';
import { jsonResponse } from './helpers';

// =============================================
// ALLOWED VALUES
// =============================================

const DEFECT_STATUSES = [
  'open', 'assigned', 'in_progress', 'resolved', 'verified', 'deferred',
] as const;

const DEFECT_SEVERITIES = ['very_high', 'high', 'medium', 'low'] as const;

const ACTION_TIMEFRAMES = [
  'immediate', '48_hours', '1_week', '1_month', 'next_inspection', 'routine',
] as const;

const DEFECT_SORT_COLUMNS = [
  'created_at', 'updated_at', 'severity', 'status', 'action_timeframe',
] as const;

/** Valid status transitions */
const VALID_TRANSITIONS: Record<string, string[]> = {
  'open': ['assigned', 'deferred'],
  'assigned': ['in_progress', 'deferred'],
  'in_progress': ['resolved', 'deferred'],
  'resolved': ['verified', 'in_progress'],  // Can reopen if verification fails
  'verified': [],                             // Terminal state
  'deferred': ['open', 'assigned'],           // Can reactivate
};

// =============================================
// LIST DEFECTS
// =============================================

export async function listDefects(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const db = createDb(ctx);
  const pagination = parsePagination(request, ctx.env);
  const { limit, offset } = paginationToOffset(pagination);
  const sortBy = parseSortField(request, [...DEFECT_SORT_COLUMNS], 'created_at');
  const sortDir = parseSortDirection(request);
  const statusFilter = parseFilterParam(request, 'status');
  const severityFilter = parseFilterParam(request, 'severity');
  const siteFilter = parseFilterParam(request, 'site_id');
  const assigneeFilter = parseFilterParam(request, 'assigned_to');
  const timeframeFilter = parseFilterParam(request, 'action_timeframe');

  // Defects join through inspection_items → inspections for org isolation
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

  if (assigneeFilter) {
    conditions.push(`d.assigned_to = $${paramIndex}`);
    params.push(assigneeFilter);
    paramIndex++;
  }

  if (timeframeFilter && ACTION_TIMEFRAMES.includes(timeframeFilter as typeof ACTION_TIMEFRAMES[number])) {
    conditions.push(`d.action_timeframe = $${paramIndex}`);
    params.push(timeframeFilter);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Count
  const countSql = `SELECT COUNT(*)::int AS count
    FROM defects d
    INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
    INNER JOIN inspections i ON ii.inspection_id = i.id
    WHERE ${whereClause}`;

  const countResult = await db.rawQuery<{ count: number }>(countSql, params);
  const totalCount = countResult[0]?.count ?? 0;

  // Fetch with joined context
  const dataSql = `SELECT d.*,
      ii.asset_code, ii.asset_type,
      i.site_id, i.inspection_type, i.inspection_date
    FROM defects d
    INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
    INNER JOIN inspections i ON ii.inspection_id = i.id
    WHERE ${whereClause}
    ORDER BY d.${sortBy} ${sortDir === 'asc' ? 'ASC' : 'DESC'}
    LIMIT ${limit} OFFSET ${offset}`;

  const defects = await db.rawQuery(dataSql, params);

  return jsonResponse({
    success: true,
    data: defects,
    meta: buildPaginationMeta(pagination, totalCount),
  }, ctx.requestId);
}

// =============================================
// GET DEFECT
// =============================================

export async function getDefect(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  const rows = await db.rawQuery<Record<string, unknown>>(
    `SELECT d.*,
        ii.asset_code, ii.asset_type, ii.voice_transcript,
        i.site_id, i.inspection_type, i.inspection_date, i.inspector_id
      FROM defects d
      INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
      INNER JOIN inspections i ON ii.inspection_id = i.id
      WHERE i.org_id = $1 AND d.id = $2
      LIMIT 1`,
    [ctx.orgId, id],
  );

  if (!rows[0]) {
    throw new NotFoundError('Defect not found');
  }

  return jsonResponse({
    success: true,
    data: rows[0],
  }, ctx.requestId);
}

// =============================================
// UPDATE DEFECT
// =============================================

export async function updateDefect(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const id = validateUUID(params['id'], 'id');
  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // Verify defect exists and belongs to this org
  const existingRows = await db.rawQuery<Record<string, unknown>>(
    `SELECT d.* FROM defects d
     INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
     INNER JOIN inspections i ON ii.inspection_id = i.id
     WHERE i.org_id = $1 AND d.id = $2
     LIMIT 1`,
    [ctx.orgId, id],
  );

  if (!existingRows[0]) {
    throw new NotFoundError('Defect not found');
  }

  const existing = existingRows[0];
  const currentStatus = existing['status'] as string;

  // ── STATE TRANSITION VALIDATION ──
  const newStatus = body['status'] as string | undefined;
  if (newStatus && newStatus !== currentStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestError(
        `Cannot transition defect from '${currentStatus}' to '${newStatus}'. ` +
        `Allowed transitions: ${allowed.length > 0 ? allowed.join(', ') : 'none'}`,
      );
    }
  }

  // Build update data
  const data: Record<string, unknown> = {};

  if ('status' in body) data['status'] = validateOptionalEnum(body['status'], 'status', DEFECT_STATUSES);
  if ('severity' in body) data['severity'] = validateOptionalEnum(body['severity'], 'severity', DEFECT_SEVERITIES);
  if ('action_timeframe' in body) data['action_timeframe'] = validateOptionalEnum(body['action_timeframe'], 'action_timeframe', ACTION_TIMEFRAMES);
  if ('assigned_to' in body) data['assigned_to'] = body['assigned_to'] ? validateUUID(body['assigned_to'], 'assigned_to') : null;
  if ('assigned_at' in body) data['assigned_at'] = validateOptionalISODate(body['assigned_at'], 'assigned_at');
  if ('resolution_notes' in body) data['resolution_notes'] = validateOptionalString(body['resolution_notes'], 'resolution_notes', { maxLength: 5000 });
  if ('resolved_at' in body) data['resolved_at'] = validateOptionalISODate(body['resolved_at'], 'resolved_at');
  if ('resolved_by' in body) data['resolved_by'] = body['resolved_by'] ? validateUUID(body['resolved_by'], 'resolved_by') : null;
  if ('verified_at' in body) data['verified_at'] = validateOptionalISODate(body['verified_at'], 'verified_at');
  if ('verified_by' in body) data['verified_by'] = body['verified_by'] ? validateUUID(body['verified_by'], 'verified_by') : null;
  if ('deferral_reason' in body) data['deferral_reason'] = validateOptionalString(body['deferral_reason'], 'deferral_reason', { maxLength: 2000 });
  if ('deferral_review_date' in body) data['deferral_review_date'] = validateOptionalISODate(body['deferral_review_date'], 'deferral_review_date');
  if ('estimated_cost_gbp' in body) data['estimated_cost_gbp'] = validateOptionalCostGbp(body['estimated_cost_gbp'], 'estimated_cost_gbp');
  if ('actual_cost_gbp' in body) data['actual_cost_gbp'] = validateOptionalCostGbp(body['actual_cost_gbp'], 'actual_cost_gbp');
  if ('repair_photo_r2_key' in body) data['repair_photo_r2_key'] = validateOptionalString(body['repair_photo_r2_key'], 'repair_photo_r2_key', { maxLength: 500 });
  if ('notes' in body) data['notes'] = validateOptionalString(body['notes'], 'notes', { maxLength: 5000 });

  // Auto-populate fields based on status transitions
  if (newStatus === 'assigned' && !data['assigned_at']) {
    data['assigned_at'] = new Date().toISOString();
    if (!data['assigned_to']) {
      data['assigned_to'] = ctx.userId;
    }
  }

  if (newStatus === 'resolved' && !data['resolved_at']) {
    data['resolved_at'] = new Date().toISOString();
    data['resolved_by'] = ctx.userId;
  }

  if (newStatus === 'verified' && !data['verified_at']) {
    data['verified_at'] = new Date().toISOString();
    data['verified_by'] = ctx.userId;
  }

  // Deferral requires a reason
  if (newStatus === 'deferred' && !data['deferral_reason'] && !existing['deferral_reason']) {
    throw new BadRequestError('Deferring a defect requires a deferral_reason');
  }

  if (Object.keys(data).length === 0) {
    return jsonResponse({ success: true, data: existing }, ctx.requestId);
  }

  data['updated_at'] = new Date().toISOString();

  // Update (raw — defects has no org_id, verified through chain)
  const setClauses = Object.keys(data).map((col, i) => `${col} = $${i + 1}`);
  const updateSql = `UPDATE defects SET ${setClauses.join(', ')} WHERE id = $${Object.keys(data).length + 1} RETURNING *`;

  const updatedRows = await db.rawQuery<Record<string, unknown>>(
    updateSql,
    [...Object.values(data), id],
  );

  // Audit with appropriate action
  let auditAction: 'defect.updated' | 'defect.assigned' | 'defect.resolved' | 'defect.verified' | 'defect.deferred' = 'defect.updated';
  if (newStatus === 'assigned') auditAction = 'defect.assigned';
  if (newStatus === 'resolved') auditAction = 'defect.resolved';
  if (newStatus === 'verified') auditAction = 'defect.verified';
  if (newStatus === 'deferred') auditAction = 'defect.deferred';

  const changes = buildChanges(existing, data);
  void writeAuditLog(ctx, auditAction, 'defects', id, changes, request);

  return jsonResponse({
    success: true,
    data: updatedRows[0] ?? existing,
  }, ctx.requestId);
}
