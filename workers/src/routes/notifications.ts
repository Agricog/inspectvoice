/**
 * InspectVoice — Notifications Route Handler
 * CRUD endpoints for managing summary email notification recipients.
 *
 * Endpoints:
 *   GET    /api/v1/notifications/recipients           — List recipients (paginated)
 *   GET    /api/v1/notifications/recipients/:id       — Get recipient detail
 *   POST   /api/v1/notifications/recipients           — Add recipient
 *   PUT    /api/v1/notifications/recipients/:id       — Update recipient
 *   DELETE /api/v1/notifications/recipients/:id       — Deactivate recipient (soft delete)
 *   GET    /api/v1/notifications/log                  — View send history (paginated)
 *
 * Access: org:admin only (enforced via role check).
 * All queries are tenant-isolated via DatabaseService (org_id from JWT).
 * All inputs are validated and sanitised server-side.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { writeAuditLog, buildChanges } from '../services/audit';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import {
  parseJsonBody,
  validateUUID,
  validateString,
  validateOptionalString,
  validateOptionalEmail,
  validateEnum,
  validateOptionalEnum,
} from '../shared/validation';
import {
  parsePagination,
  buildPaginationMeta,
  paginationToOffset,
  parseSortField,
  parseSortDirection,
  parseFilterParam,
} from '../shared/pagination';
import { jsonResponse, noContentResponse } from './helpers';

// =============================================
// CONSTANTS
// =============================================

const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

const RECIPIENT_SORT_COLUMNS = [
  'display_name', 'frequency', 'created_at', 'updated_at',
] as const;

const LOG_SORT_COLUMNS = ['sent_at', 'status'] as const;

const LOG_STATUSES = ['sent', 'failed', 'skipped'] as const;

// =============================================
// ADMIN ROLE GUARD
// =============================================

function requireAdmin(ctx: RequestContext): void {
  if (ctx.userRole !== 'admin') {
    throw Object.assign(
      new Error('Only organisation admins can manage notification settings'),
      { statusCode: 403 },
    );
  }
}

// =============================================
// BOOLEAN BODY HELPER
// =============================================

function validateOptionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw Object.assign(
      new Error(`${field} must be a boolean`),
      { statusCode: 400 },
    );
  }
  return value;
}

// =============================================
// LIST RECIPIENTS
// =============================================

export async function listNotificationRecipients(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireAdmin(ctx);
  await checkRateLimit(ctx, 'read');

  const db = createDb(ctx);
  const pagination = parsePagination(request, ctx.env);
  const { limit, offset } = paginationToOffset(pagination);
  const sortBy = parseSortField(request, [...RECIPIENT_SORT_COLUMNS], 'display_name');
  const sortDir = parseSortDirection(request);
  const frequencyFilter = parseFilterParam(request, 'frequency');
  const siteFilter = parseFilterParam(request, 'site_id');

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 2; // $1 is org_id

  // Default: show only active. Allow ?show_inactive=true for full list.
  const showInactive = new URL(request.url).searchParams.get('show_inactive') === 'true';
  if (!showInactive) {
    conditions.push('is_active = true');
  }

  if (frequencyFilter && FREQUENCIES.includes(frequencyFilter as typeof FREQUENCIES[number])) {
    conditions.push(`frequency = $${paramIndex}`);
    params.push(frequencyFilter);
    paramIndex++;
  }

  if (siteFilter) {
    conditions.push(`site_id = $${paramIndex}`);
    params.push(siteFilter);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '';

  const totalCount = await db.count('notification_recipients', whereClause, params);

  const recipients = await db.findMany(
    'notification_recipients',
    whereClause,
    params,
    {
      orderBy: sortBy,
      orderDirection: sortDir,
      limit,
      offset,
    },
  );

  return jsonResponse({
    success: true,
    data: recipients,
    meta: buildPaginationMeta(pagination, totalCount),
  }, ctx.requestId);
}

// =============================================
// GET RECIPIENT
// =============================================

export async function getNotificationRecipient(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireAdmin(ctx);
  await checkRateLimit(ctx, 'read');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  const recipient = await db.findByIdOrThrow(
    'notification_recipients',
    id,
    'Notification recipient',
  );

  return jsonResponse({
    success: true,
    data: recipient,
  }, ctx.requestId);
}

// =============================================
// CREATE RECIPIENT
// =============================================

export async function createNotificationRecipient(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireAdmin(ctx);
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // Validate target: exactly one of clerk_user_id or external_email
  const clerkUserId = validateOptionalString(
    body['clerk_user_id'], 'clerk_user_id', { maxLength: 200 },
  );
  const externalEmail = validateOptionalEmail(
    body['external_email'], 'external_email',
  );

  if ((!clerkUserId && !externalEmail) || (clerkUserId && externalEmail)) {
    throw Object.assign(
      new Error('Provide exactly one of clerk_user_id or external_email'),
      { statusCode: 400 },
    );
  }

  // If clerk_user_id, validate it exists in our users table
  if (clerkUserId) {
    const userRows = await db.findMany(
      'users',
      `id = $2`,
      [clerkUserId],
      { limit: 1, offset: 0 },
    );
    if (!userRows || (userRows as unknown[]).length === 0) {
      throw Object.assign(
        new Error('Clerk user not found in this organisation'),
        { statusCode: 400 },
      );
    }
  }

  // Validate optional site_id
  if (body['site_id']) {
    const siteId = validateUUID(body['site_id'], 'site_id');
    await db.findByIdOrThrow('sites', siteId, 'Site');
  }

  const data = {
    id: crypto.randomUUID(),
    clerk_user_id: clerkUserId ?? null,
    external_email: externalEmail ?? null,
    display_name: validateString(body['display_name'], 'display_name', { maxLength: 200 }),
    frequency: validateEnum(body['frequency'] ?? 'weekly', 'frequency', FREQUENCIES),
    site_id: body['site_id'] ? validateUUID(body['site_id'], 'site_id') : null,
    notify_hotlist: validateOptionalBoolean(body['notify_hotlist'], 'notify_hotlist') ?? true,
    notify_inspections: validateOptionalBoolean(body['notify_inspections'], 'notify_inspections') ?? true,
    notify_defects: validateOptionalBoolean(body['notify_defects'], 'notify_defects') ?? true,
    notify_overdue: validateOptionalBoolean(body['notify_overdue'], 'notify_overdue') ?? true,
    is_active: true,
    created_by: ctx.userId,
  };

  const recipient = await db.insert('notification_recipients', data);

  void writeAuditLog(
    ctx,
    'notification_recipient.created',
    'notification_recipients',
    data.id,
    { display_name: data.display_name, frequency: data.frequency },
    request,
  );

  return jsonResponse({
    success: true,
    data: recipient,
  }, ctx.requestId, 201);
}

// =============================================
// UPDATE RECIPIENT
// =============================================

export async function updateNotificationRecipient(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireAdmin(ctx);
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const id = validateUUID(params['id'], 'id');
  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  const existing = await db.findByIdOrThrow<Record<string, unknown>>(
    'notification_recipients',
    id,
    'Notification recipient',
  );

  const data: Record<string, unknown> = {};

  if ('display_name' in body) {
    data['display_name'] = validateString(body['display_name'], 'display_name', { maxLength: 200 });
  }
  if ('frequency' in body) {
    data['frequency'] = validateEnum(body['frequency'], 'frequency', FREQUENCIES);
  }
  if ('site_id' in body) {
    if (body['site_id'] === null) {
      data['site_id'] = null;
    } else {
      const siteId = validateUUID(body['site_id'], 'site_id');
      await db.findByIdOrThrow('sites', siteId, 'Site');
      data['site_id'] = siteId;
    }
  }
  if ('notify_hotlist' in body) {
    data['notify_hotlist'] = validateOptionalBoolean(body['notify_hotlist'], 'notify_hotlist') ?? true;
  }
  if ('notify_inspections' in body) {
    data['notify_inspections'] = validateOptionalBoolean(body['notify_inspections'], 'notify_inspections') ?? true;
  }
  if ('notify_defects' in body) {
    data['notify_defects'] = validateOptionalBoolean(body['notify_defects'], 'notify_defects') ?? true;
  }
  if ('notify_overdue' in body) {
    data['notify_overdue'] = validateOptionalBoolean(body['notify_overdue'], 'notify_overdue') ?? true;
  }
  if ('is_active' in body) {
    data['is_active'] = validateOptionalBoolean(body['is_active'], 'is_active') ?? true;
  }

  if (Object.keys(data).length === 0) {
    return noContentResponse(ctx.requestId);
  }

  const updated = await db.updateById('notification_recipients', id, data);

  const changes = buildChanges(existing, data);
  if (Object.keys(changes).length > 0) {
    void writeAuditLog(
      ctx,
      'notification_recipient.updated',
      'notification_recipients',
      id,
      changes,
      request,
    );
  }

  return jsonResponse({
    success: true,
    data: updated,
  }, ctx.requestId);
}

// =============================================
// DEACTIVATE RECIPIENT (soft delete)
// =============================================

export async function deactivateNotificationRecipient(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireAdmin(ctx);
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  await db.findByIdOrThrow('notification_recipients', id, 'Notification recipient');

  const updated = await db.updateById('notification_recipients', id, {
    is_active: false,
  });

  void writeAuditLog(
    ctx,
    'notification_recipient.deactivated',
    'notification_recipients',
    id,
    { is_active: { from: true, to: false } },
    request,
  );

  return jsonResponse({
    success: true,
    data: updated,
  }, ctx.requestId);
}

// =============================================
// LIST NOTIFICATION LOG
// =============================================

export async function listNotificationLog(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireAdmin(ctx);
  await checkRateLimit(ctx, 'read');

  const db = createDb(ctx);
  const pagination = parsePagination(request, ctx.env);
  const { limit, offset } = paginationToOffset(pagination);
  const sortBy = parseSortField(request, [...LOG_SORT_COLUMNS], 'sent_at');
  const sortDir = parseSortDirection(request, 'desc');
  const statusFilter = parseFilterParam(request, 'status');

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 2;

  if (statusFilter && LOG_STATUSES.includes(statusFilter as typeof LOG_STATUSES[number])) {
    conditions.push(`status = $${paramIndex}`);
    params.push(statusFilter);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '';

  const totalCount = await db.count('notification_log', whereClause, params);

  const logs = await db.findMany(
    'notification_log',
    whereClause,
    params,
    {
      orderBy: sortBy,
      orderDirection: sortDir,
      limit,
      offset,
    },
  );

  return jsonResponse({
    success: true,
    data: logs,
    meta: buildPaginationMeta(pagination, totalCount),
  }, ctx.requestId);
}
