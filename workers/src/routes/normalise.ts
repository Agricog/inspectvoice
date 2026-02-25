/**
 * InspectVoice — Normalisation Route Handler
 * API endpoints for AI style normalisation of inspection text.
 *
 * Endpoints:
 *   POST   /api/v1/normalise/field              — Normalise single field ("Normalise now" button)
 *   POST   /api/v1/normalise/batch              — Batch normalise at sign-off review
 *   POST   /api/v1/normalise/:id/accept         — Accept a suggestion
 *   POST   /api/v1/normalise/:id/reject         — Reject a suggestion with reason
 *   GET    /api/v1/normalise/history             — Manager view of normalisation history
 *   GET    /api/v1/normalise/usage               — Token usage stats for org
 *
 * All queries are tenant-isolated via org_id from JWT.
 * All inputs are validated and sanitised server-side.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon } from '@neondatabase/serverless';
import type { RequestContext, RouteParams } from '../types';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import {
  parseJsonBody,
  validateUUID,
  validateString,
  validateEnum,
  validateOptionalString,
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
import {
  normaliseField,
  normaliseBatch,
  acceptNormalisation,
  rejectNormalisation,
  resolveStyleConfig,
  type NormaliseFieldInput,
  type NormalisableField,
} from '../services/normalise';

// =============================================
// CONSTANTS
// =============================================

const NORMALISABLE_FIELDS = [
  'defect_description',
  'remedial_action',
  'inspector_summary',
  'condition_observation',
] as const;

const HISTORY_SORT_COLUMNS = ['created_at', 'field_name', 'status'] as const;
const HISTORY_STATUSES = ['pending', 'accepted', 'rejected'] as const;

// =============================================
// RESOLVE ORG STYLE CONFIG
// =============================================

async function getOrgStyleConfig(ctx: RequestContext): Promise<ReturnType<typeof resolveStyleConfig>> {
  const sql = neon(ctx.env.DATABASE_URL);

  const rows = await sql(
    `SELECT settings FROM organisations WHERE org_id = $1 LIMIT 1`,
    [ctx.orgId],
  );

  if (rows.length === 0) {
    throw Object.assign(new Error('Organisation not found'), { statusCode: 404 });
  }

  const settings = (rows[0] as Record<string, unknown>)['settings'];
  const orgSettings = (typeof settings === 'object' && settings !== null)
    ? settings as Record<string, unknown>
    : {};

  const style = resolveStyleConfig(orgSettings);

  if (!style.enabled) {
    throw Object.assign(
      new Error('AI normalisation is not enabled for this organisation. Enable it in Settings → Writing Style.'),
      { statusCode: 403 },
    );
  }

  return style;
}

// =============================================
// NORMALISE SINGLE FIELD
// =============================================

export async function normaliseFieldEndpoint(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const body = await parseJsonBody(request);
  const style = await getOrgStyleConfig(ctx);

  const fieldName = validateEnum(
    body['field_name'],
    'field_name',
    NORMALISABLE_FIELDS,
  ) as NormalisableField;

  const input: NormaliseFieldInput = {
    fieldName,
    originalText: validateString(body['original_text'], 'original_text', { maxLength: 5000 }),
    inspectionId: body['inspection_id']
      ? validateUUID(body['inspection_id'], 'inspection_id')
      : undefined,
    inspectionItemId: body['inspection_item_id']
      ? validateUUID(body['inspection_item_id'], 'inspection_item_id')
      : undefined,
    defectId: body['defect_id']
      ? validateUUID(body['defect_id'], 'defect_id')
      : undefined,
    assetType: typeof body['asset_type'] === 'string'
      ? body['asset_type']
      : undefined,
  };

  const result = await normaliseField(
    input,
    style,
    ctx.orgId,
    ctx.userId,
    ctx.env,
    ctx.requestId,
  );

  return jsonResponse({
    success: true,
    data: result,
  }, ctx.requestId);
}

// =============================================
// BATCH NORMALISE (sign-off review)
// =============================================

export async function normaliseBatchEndpoint(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const body = await parseJsonBody(request);
  const style = await getOrgStyleConfig(ctx);

  // Validate fields array
  const rawFields = body['fields'];
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    throw Object.assign(new Error('fields must be a non-empty array'), { statusCode: 400 });
  }

  if (rawFields.length > 50) {
    throw Object.assign(new Error('Maximum 50 fields per batch'), { statusCode: 400 });
  }

  const inputs: NormaliseFieldInput[] = [];

  for (const field of rawFields as Record<string, unknown>[]) {
    if (!field || typeof field !== 'object') continue;

    const fieldName = validateEnum(
      field['field_name'],
      'field_name',
      NORMALISABLE_FIELDS,
    ) as NormalisableField;

    inputs.push({
      fieldName,
      originalText: validateString(field['original_text'] as string, 'original_text', { maxLength: 5000 }),
      inspectionId: field['inspection_id']
        ? validateUUID(field['inspection_id'] as string, 'inspection_id')
        : undefined,
      inspectionItemId: field['inspection_item_id']
        ? validateUUID(field['inspection_item_id'] as string, 'inspection_item_id')
        : undefined,
      defectId: field['defect_id']
        ? validateUUID(field['defect_id'] as string, 'defect_id')
        : undefined,
    });
  }

  const result = await normaliseBatch(
    inputs,
    style,
    ctx.orgId,
    ctx.userId,
    ctx.env,
    ctx.requestId,
  );

  return jsonResponse({
    success: true,
    data: result,
  }, ctx.requestId);
}

// =============================================
// ACCEPT NORMALISATION
// =============================================

export async function acceptNormalisationEndpoint(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const logId = validateUUID(params['id'], 'id');

  const result = await acceptNormalisation(
    logId,
    ctx.orgId,
    ctx.userId,
    ctx.env,
  );

  return jsonResponse({
    success: true,
    data: result,
  }, ctx.requestId);
}

// =============================================
// REJECT NORMALISATION
// =============================================

export async function rejectNormalisationEndpoint(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const logId = validateUUID(params['id'], 'id');
  const body = await parseJsonBody(request);

  const reason = validateOptionalString(body['reason'], 'reason', { maxLength: 500 })
    ?? 'No reason provided';

  await rejectNormalisation(
    logId,
    ctx.orgId,
    ctx.userId,
    reason,
    ctx.env,
  );

  return jsonResponse({
    success: true,
    data: { id: logId, status: 'rejected' },
  }, ctx.requestId);
}

// =============================================
// NORMALISATION HISTORY (manager view)
// =============================================

export async function listNormalisationHistory(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  // Admin or manager only
  if (ctx.userRole !== 'admin' && ctx.userRole !== 'manager') {
    throw Object.assign(
      new Error('Only admins and managers can view normalisation history'),
      { statusCode: 403 },
    );
  }
  await checkRateLimit(ctx, 'read');

  const sql = neon(ctx.env.DATABASE_URL);
  const pagination = parsePagination(request, ctx.env);
  const { limit, offset } = paginationToOffset(pagination);
  const sortBy = parseSortField(request, [...HISTORY_SORT_COLUMNS], 'created_at');
  const sortDir = parseSortDirection(request, 'desc');
  const statusFilter = parseFilterParam(request, 'status');
  const fieldFilter = parseFilterParam(request, 'field_name');
  const inspectorFilter = parseFilterParam(request, 'requested_by');

  const conditions: string[] = ['org_id = $1'];
  const params: unknown[] = [ctx.orgId];
  let paramIndex = 2;

  if (statusFilter && HISTORY_STATUSES.includes(statusFilter as typeof HISTORY_STATUSES[number])) {
    conditions.push(`status = $${paramIndex}`);
    params.push(statusFilter);
    paramIndex++;
  }

  if (fieldFilter && NORMALISABLE_FIELDS.includes(fieldFilter as typeof NORMALISABLE_FIELDS[number])) {
    conditions.push(`field_name = $${paramIndex}`);
    params.push(fieldFilter);
    paramIndex++;
  }

  if (inspectorFilter) {
    conditions.push(`requested_by = $${paramIndex}`);
    params.push(inspectorFilter);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  const countRows = await sql(
    `SELECT COUNT(*)::int AS total FROM normalisation_log WHERE ${whereClause}`,
    params,
  );
  const totalCount = Number((countRows[0] as Record<string, unknown>)['total'] ?? 0);

  const rows = await sql(
    `SELECT id, org_id, inspection_id, inspection_item_id, defect_id,
            field_name, original_text, normalised_text, diff_summary,
            status, rejected_reason, model_used, prompt_version,
            input_tokens, output_tokens, style_preset,
            requested_by, reviewed_by, reviewed_at, created_at
     FROM normalisation_log
     WHERE ${whereClause}
     ORDER BY ${sortBy} ${sortDir}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset],
  );

  return jsonResponse({
    success: true,
    data: rows,
    meta: buildPaginationMeta(pagination, totalCount),
  }, ctx.requestId);
}

// =============================================
// TOKEN USAGE STATS
// =============================================

export async function getNormalisationUsage(
  _request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  if (ctx.userRole !== 'admin') {
    throw Object.assign(
      new Error('Only admins can view normalisation usage'),
      { statusCode: 403 },
    );
  }
  await checkRateLimit(ctx, 'read');

  const sql = neon(ctx.env.DATABASE_URL);

  // Current month + last 6 months
  const rows = await sql(
    `SELECT month_year, input_tokens_total, output_tokens_total,
            request_count, estimated_cost_usd
     FROM normalisation_usage
     WHERE org_id = $1
     ORDER BY month_year DESC
     LIMIT 7`,
    [ctx.orgId],
  );

  // Get org budget for context
  const orgRows = await sql(
    `SELECT settings FROM organisations WHERE org_id = $1 LIMIT 1`,
    [ctx.orgId],
  );

  const settings = orgRows.length > 0
    ? (orgRows[0] as Record<string, unknown>)['settings'] as Record<string, unknown> | null
    : null;
  const style = resolveStyleConfig(settings ?? {});

  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentRow = (rows as Record<string, unknown>[]).find(
    (r) => r['month_year'] === currentMonth,
  );
  const currentUsed = currentRow
    ? Number(currentRow['input_tokens_total'] ?? 0) + Number(currentRow['output_tokens_total'] ?? 0)
    : 0;

  return jsonResponse({
    success: true,
    data: {
      monthly_budget: style.monthlyTokenBudget,
      current_month: currentMonth,
      current_tokens_used: currentUsed,
      budget_remaining: Math.max(0, style.monthlyTokenBudget - currentUsed),
      budget_percentage_used: style.monthlyTokenBudget > 0
        ? Math.round((currentUsed / style.monthlyTokenBudget) * 100)
        : 0,
      history: rows,
    },
  }, ctx.requestId);
}
