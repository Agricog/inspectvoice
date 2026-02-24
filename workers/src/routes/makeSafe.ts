/**
 * InspectVoice — Make Safe Actions Route Handler
 * Records on-site make-safe actions for high-risk defects.
 *
 * Endpoints:
 *   POST   /api/v1/defects/:defectId/make-safe   — Record a make-safe action
 *   GET    /api/v1/defects/:defectId/make-safe    — List make-safe actions for a defect
 *   GET    /api/v1/make-safe/recent               — Recent make-safe actions across all sites
 *
 * Workflow:
 *   1. Inspector finds high-risk defect on site
 *   2. Takes immediate action (barrier tape, close asset, etc.)
 *   3. Takes evidence photo of the make-safe action
 *   4. Records what was done + recommendation via this endpoint
 *   5. Trigger auto-updates the parent defect (made_safe = true)
 *   6. Optionally notifies manager
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { writeAuditLog } from '../services/audit';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { NotFoundError, BadRequestError } from '../shared/errors';
import {
  parseJsonBody,
  validateUUID,
  validateRequiredString,
  validateOptionalString,
  validateOptionalEnum,
  validateOptionalNumber,
} from '../shared/validation';
import {
  parsePagination,
  buildPaginationMeta,
  paginationToOffset,
} from '../shared/pagination';
import { jsonResponse } from './helpers';

// =============================================
// ALLOWED VALUES
// =============================================

const MAKE_SAFE_ACTIONS = [
  'barrier_tape',
  'signage_placed',
  'asset_closed',
  'area_cordoned',
  'asset_removed',
  'temporary_repair',
  'verbal_warning_given',
  'other',
] as const;

const NOTIFICATION_METHODS = ['in_app', 'email', 'sms', 'phone'] as const;

// =============================================
// CREATE MAKE-SAFE ACTION
// =============================================

export async function createMakeSafeAction(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const defectId = validateUUID(params['defectId'], 'defectId');
  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // ── Verify defect exists and belongs to this org ──
  const defectRows = await db.rawQuery<Record<string, unknown>>(
    `SELECT d.id, d.severity, d.site_id, d.asset_id, d.made_safe
     FROM defects d
     INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
     INNER JOIN inspections i ON ii.inspection_id = i.id
     WHERE i.org_id = $1 AND d.id = $2
     LIMIT 1`,
    [ctx.orgId, defectId],
  );

  if (!defectRows[0]) {
    throw new NotFoundError('Defect not found');
  }

  const defect = defectRows[0];

  // ── Validate required fields ──
  const actionTaken = validateRequiredString(body['action_taken'], 'action_taken', { maxLength: 50 });
  if (!MAKE_SAFE_ACTIONS.includes(actionTaken as typeof MAKE_SAFE_ACTIONS[number])) {
    throw new BadRequestError(
      `Invalid action_taken. Must be one of: ${MAKE_SAFE_ACTIONS.join(', ')}`,
    );
  }

  const actionDetails = validateRequiredString(body['action_details'], 'action_details', { maxLength: 2000 });
  const recommendation = validateRequiredString(body['recommendation'], 'recommendation', { maxLength: 2000 });

  // ── Validate optional fields ──
  const photoR2Key = validateOptionalString(body['photo_r2_key'], 'photo_r2_key', { maxLength: 500 });
  const photoR2Url = validateOptionalString(body['photo_r2_url'], 'photo_r2_url', { maxLength: 1000 });
  const latitude = validateOptionalNumber(body['latitude'], 'latitude');
  const longitude = validateOptionalNumber(body['longitude'], 'longitude');
  const assetClosed = typeof body['asset_closed'] === 'boolean' ? body['asset_closed'] : false;
  const notificationMethod = validateOptionalEnum(
    body['notification_method'],
    'notification_method',
    NOTIFICATION_METHODS,
  );

  // ── Insert make-safe action ──
  const insertSql = `
    INSERT INTO make_safe_actions (
      defect_id, org_id, site_id, asset_id, performed_by,
      action_taken, action_details, recommendation,
      photo_r2_key, photo_r2_url,
      latitude, longitude, performed_at,
      asset_closed,
      manager_notified, notification_method
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8,
      $9, $10,
      $11, $12, NOW(),
      $13,
      $14, $15
    ) RETURNING *
  `;

  const managerNotified = Boolean(notificationMethod);

  const rows = await db.rawQuery<Record<string, unknown>>(insertSql, [
    defectId,
    ctx.orgId,
    defect['site_id'],
    defect['asset_id'] ?? null,
    ctx.userId,
    actionTaken,
    actionDetails,
    recommendation,
    photoR2Key ?? null,
    photoR2Url ?? null,
    latitude ?? null,
    longitude ?? null,
    assetClosed,
    managerNotified,
    notificationMethod ?? null,
  ]);

  const makeSafeAction = rows[0];

  // ── If asset was closed, update asset status ──
  if (assetClosed && defect['asset_id']) {
    await db.rawQuery(
      `UPDATE assets SET
        is_active = false,
        decommissioned_date = CURRENT_DATE,
        decommission_reason = $1,
        updated_at = NOW()
       WHERE id = $2 AND org_id = $3`,
      [
        `Made safe: ${actionDetails}`,
        defect['asset_id'],
        ctx.orgId,
      ],
    );
  }

  // ── Audit ──
  void writeAuditLog(
    ctx,
    'defect.made_safe',
    'make_safe_actions',
    makeSafeAction?.['id'] as string ?? defectId,
    {
      defect_id: defectId,
      action_taken: actionTaken,
      asset_closed: assetClosed,
      severity: defect['severity'],
    },
    request,
  );

  return jsonResponse({
    success: true,
    data: makeSafeAction,
  }, ctx.requestId, 201);
}

// =============================================
// LIST MAKE-SAFE ACTIONS FOR A DEFECT
// =============================================

export async function listMakeSafeActions(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const defectId = validateUUID(params['defectId'], 'defectId');
  const db = createDb(ctx);

  const rows = await db.rawQuery<Record<string, unknown>>(
    `SELECT msa.*,
       u.first_name || ' ' || u.last_name AS performed_by_name
     FROM make_safe_actions msa
     LEFT JOIN users u ON msa.performed_by = u.id
     WHERE msa.org_id = $1 AND msa.defect_id = $2
     ORDER BY msa.performed_at DESC`,
    [ctx.orgId, defectId],
  );

  return jsonResponse({
    success: true,
    data: rows,
  }, ctx.requestId);
}

// =============================================
// RECENT MAKE-SAFE ACTIONS (ALL SITES)
// =============================================

export async function recentMakeSafeActions(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const db = createDb(ctx);
  const pagination = parsePagination(request, ctx.env);
  const { limit, offset } = paginationToOffset(pagination);

  // Count
  const countResult = await db.rawQuery<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM make_safe_actions
     WHERE org_id = $1`,
    [ctx.orgId],
  );
  const totalCount = countResult[0]?.count ?? 0;

  // Fetch with context
  const rows = await db.rawQuery<Record<string, unknown>>(
    `SELECT msa.*,
       u.first_name || ' ' || u.last_name AS performed_by_name,
       s.name AS site_name,
       d.description AS defect_description,
       d.severity AS defect_severity
     FROM make_safe_actions msa
     LEFT JOIN users u ON msa.performed_by = u.id
     LEFT JOIN sites s ON msa.site_id = s.id
     LEFT JOIN defects d ON msa.defect_id = d.id
     WHERE msa.org_id = $1
     ORDER BY msa.performed_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    [ctx.orgId],
  );

  return jsonResponse({
    success: true,
    data: rows,
    meta: buildPaginationMeta(pagination, totalCount),
  }, ctx.requestId);
}
