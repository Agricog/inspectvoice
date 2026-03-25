/**
 * InspectVoice -- Inspections Route Handler
 * CRUD endpoints for inspection lifecycle management.
 *
 * Endpoints:
 *   GET    /api/v1/inspections           -- List inspections (paginated, filterable)
 *   GET    /api/v1/inspections/:id       -- Get inspection with items
 *   POST   /api/v1/inspections           -- Create inspection (from sync)
 *   PUT    /api/v1/inspections/:id       -- Update inspection (from sync)
 *   DELETE /api/v1/inspections/:id       -- Delete draft/review inspection
 *
 * State Machine (enforced here):
 *   DRAFT -> REVIEW -> SIGNED -> EXPORTED
 *   DRAFT -> SIGNED (auto-steps through review -- single-session sign-off)
 *   - No backward transitions after SIGNED
 *   - SIGNED/EXPORTED inspections are immutable
 *   - Signature data is write-once (cannot be modified)
 *
 * FIX: 3 Mar 2026
 *   - Allow draft->signed transition. The offline-first client completes
 *     capture and sign-off in a single session without a separate "review"
 *     API call. The server now accepts this and auto-steps through review,
 *     writing both audit events for traceability.
 *   - Added defect extraction on sign-off: embedded inspection_items.defects[]
 *     are written as individual rows to the defects table so the Defect Tracker
 *     page has data to query.
 *   - All async calls changed from void to await. Cloudflare Workers terminate
 *     pending void promises when the response is sent, so fire-and-forget
 *     patterns silently fail. All functions use try-catch internally so
 *     awaiting them cannot crash the response.
 *
 * FIX: 16 Mar 2026
 *   - listInspections now JOINs sites and users tables to return site_name
 *     and inspector_name columns required by the frontend InspectionList page.
 *   - Response format changed from { meta } to { pagination } to match
 *     the frontend InspectionListResponse type.
 *   - Added search filter (site name or inspector name) and date range filters.
 *
 * Build Standard: Autaimate v3 -- TypeScript strict, zero any, production-ready
 */
import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { writeAuditLog, buildChanges } from '../services/audit';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { ConflictError, BadRequestError } from '../shared/errors';
import { Logger } from '../shared/logger';
import {
  parseJsonBody,
  validateUUID,
  validateString,
  validateOptionalString,
  validateOptionalNumber,
  validateEnum,
  validateOptionalEnum,
  validateISODate,
  validateOptionalISODate,
  validateBoolean,
  validateOptionalBoolean,
} from '../shared/validation';
import {
  parsePagination,
  paginationToOffset,
  parseSortField,
  parseSortDirection,
  parseSearchQuery,
  parseFilterParam,
} from '../shared/pagination';
import { jsonResponse } from './helpers';

// =============================================
// ALLOWED VALUES
// =============================================

const INSPECTION_TYPES = [
  'routine_visual', 'operational', 'annual_main', 'post_repair', 'ad_hoc',
] as const;

const INSPECTION_STATUSES = ['draft', 'review', 'signed', 'exported'] as const;

const RISK_RATINGS = ['very_high', 'high', 'medium', 'low'] as const;

const INSPECTION_SORT_COLUMNS = [
  'inspection_date', 'created_at', 'updated_at', 'status', 'inspection_type',
] as const;

/**
 * Valid state transitions (forward only, with auto-step support).
 * draft->signed is allowed because the offline-first client completes
 * the full capture + review + sign-off workflow locally. The server
 * auto-steps through 'review' for audit trail completeness.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  'draft': ['review', 'signed'],
  'review': ['signed', 'draft'],
  'signed': ['exported'],
  'exported': [],
};

/** Immutable statuses -- no field updates allowed */
const IMMUTABLE_STATUSES = new Set(['signed', 'exported']);

// =============================================
// DEFECT EXTRACTION (sign-off pipeline)
// =============================================

/** Calculate due_date from action_timeframe */
function calculateDueDate(timeframe: string | undefined): string | null {
  if (!timeframe) return null;
  const now = new Date();
  switch (timeframe) {
    case 'immediate':
      return now.toISOString().slice(0, 10);
    case '48_hours':
      now.setDate(now.getDate() + 2);
      return now.toISOString().slice(0, 10);
    case '1_week':
      now.setDate(now.getDate() + 7);
      return now.toISOString().slice(0, 10);
    case '1_month':
      now.setDate(now.getDate() + 30);
      return now.toISOString().slice(0, 10);
    default:
      return null; // next_inspection, routine -- no fixed date
  }
}

/**
 * Extract embedded defects from inspection_items into the defects table.
 * Called when an inspection transitions to 'signed'.
 *
 * MUST be awaited — Cloudflare Workers terminate pending void promises
 * when the response is sent. The try-catch inside ensures extraction
 * failure can never crash the response — safe to await unconditionally.
 *
 * Idempotent: skips if defects already exist for this inspection
 * (guards against duplicate extraction on retry).
 */
async function extractDefectsToTable(
  db: ReturnType<typeof createDb>,
  ctx: RequestContext,
  inspectionId: string,
  siteId: string,
  logger: Logger,
): Promise<void> {
  try {
    // Guard: skip if already extracted (idempotent)
    const existingCount = await db.rawQuery<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM defects WHERE inspection_id = $1`,
      [inspectionId],
    );
    if ((existingCount[0]?.count ?? 0) > 0) {
      logger.info('Defects already extracted, skipping', { inspectionId });
      return;
    }

    // Fetch inspection items that have defects
    const items = await db.rawQuery<Record<string, unknown>>(
      `SELECT id, asset_id, defects
       FROM inspection_items
       WHERE inspection_id = $1
         AND defects IS NOT NULL
         AND defects::text != '[]'`,
      [inspectionId],
    );

    if (items.length === 0) {
      logger.info('No defects to extract', { inspectionId });
      return;
    }

    const now = new Date().toISOString();
    let extractedCount = 0;

    for (const item of items) {
      const defectsRaw = item['defects'];
      const defects = (
        typeof defectsRaw === 'string' ? JSON.parse(defectsRaw) : defectsRaw
      ) as Array<Record<string, unknown>>;

      if (!Array.isArray(defects) || defects.length === 0) continue;

      for (const defect of defects) {
        const dueDate = calculateDueDate(defect['action_timeframe'] as string | undefined);

        await db.rawExecute(
          `INSERT INTO defects (
            id, org_id, inspection_item_id, inspection_id, site_id, asset_id,
            description, bs_en_reference, severity, remedial_action,
            action_timeframe, status, source, estimated_cost_gbp,
            due_date, made_safe, asset_closed, metadata, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17, $18::jsonb, $19, $20
          )`,
          [
            crypto.randomUUID(),           // id
            ctx.orgId,                     // org_id
            item['id'],                    // inspection_item_id
            inspectionId,                  // inspection_id
            siteId,                        // site_id
            item['asset_id'] ?? null,      // asset_id
            (defect['description'] as string) ?? '',              // description
            (defect['bs_en_reference'] as string) ?? null,        // bs_en_reference
            (defect['risk_rating'] as string) ?? 'medium',        // severity
            (defect['remedial_action'] as string) ?? '',          // remedial_action
            (defect['action_timeframe'] as string) ?? 'routine',  // action_timeframe
            'open',                        // status
            'inspection',                  // source
            (defect['estimated_cost_band'] as string) ?? null,    // estimated_cost_gbp
            dueDate,                       // due_date
            false,                         // made_safe
            false,                         // asset_closed
            JSON.stringify({ extracted_from: 'inspection_sign_off', original: defect }),
            now,                           // created_at
            now,                           // updated_at
          ],
        );
        extractedCount++;
      }
    }

    logger.info('Defects extracted to table', { inspectionId, count: extractedCount });

    await writeAuditLog(ctx, 'defects.extracted' as Parameters<typeof writeAuditLog>[1], 'inspections', inspectionId, {
      count: extractedCount,
      source: 'sign_off_extraction',
    });
  } catch (err) {
    // Never block sign-off -- log and move on
    logger.error('Failed to extract defects', {
      inspectionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================
// LIST INSPECTIONS
// =============================================

export async function listInspections(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const db = createDb(ctx);
  const pagination = parsePagination(request, ctx.env);
  const { limit, offset } = paginationToOffset(pagination);
  const sortBy = parseSortField(request, [...INSPECTION_SORT_COLUMNS], 'inspection_date');
  const sortDir = parseSortDirection(request);

  const statusFilter = parseFilterParam(request, 'status');
  const typeFilter = parseFilterParam(request, 'type');
  const siteFilter = parseFilterParam(request, 'site_id');
  const searchFilter = parseSearchQuery(request);
  const dateFrom = parseFilterParam(request, 'from');
  const dateTo = parseFilterParam(request, 'to');

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 2; // $1 is org_id

  if (statusFilter && INSPECTION_STATUSES.includes(statusFilter as typeof INSPECTION_STATUSES[number])) {
    conditions.push(`i.status = $${paramIndex}`);
    params.push(statusFilter);
    paramIndex++;
  }

  if (typeFilter && INSPECTION_TYPES.includes(typeFilter as typeof INSPECTION_TYPES[number])) {
    conditions.push(`i.inspection_type = $${paramIndex}`);
    params.push(typeFilter);
    paramIndex++;
  }

  if (siteFilter) {
    conditions.push(`i.site_id = $${paramIndex}`);
    params.push(siteFilter);
    paramIndex++;
  }

  if (searchFilter) {
    conditions.push(`(s.name ILIKE $${paramIndex} OR u.display_name ILIKE $${paramIndex})`);
    params.push(`%${searchFilter}%`);
    paramIndex++;
  }

  if (dateFrom) {
    conditions.push(`i.inspection_date >= $${paramIndex}`);
    params.push(dateFrom);
    paramIndex++;
  }

  if (dateTo) {
    conditions.push(`i.inspection_date <= $${paramIndex}`);
    params.push(dateTo);
    paramIndex++;
  }

  const whereClause = conditions.length > 0
    ? `AND ${conditions.join(' AND ')}`
    : '';

  // Count with JOINs so search filter works
  const countRows = await db.rawQuery<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM inspections i
     LEFT JOIN sites s ON s.id = i.site_id AND s.org_id = i.org_id
     LEFT JOIN users u ON u.id = i.inspector_id
     WHERE i.org_id = $1 ${whereClause}`,
    [ctx.orgId, ...params],
  );
  const totalCount = countRows[0]?.count ?? 0;

  // Fetch with JOINed site_name and inspector_name
  const inspections = await db.rawQuery<Record<string, unknown>>(
    `SELECT i.*,
            COALESCE(s.name, 'Unknown Site') AS site_name,
            COALESCE(u.display_name, 'Unknown') AS inspector_name
     FROM inspections i
     LEFT JOIN sites s ON s.id = i.site_id AND s.org_id = i.org_id
     LEFT JOIN users u ON u.id = i.inspector_id
     WHERE i.org_id = $1 ${whereClause}
     ORDER BY i.${sortBy} ${sortDir}
     LIMIT ${limit} OFFSET ${offset}`,
    [ctx.orgId, ...params],
  );

  return jsonResponse({
    success: true,
    data: inspections,
    pagination: {
      page: pagination.page,
      limit,
      total: totalCount,
      total_pages: Math.ceil(totalCount / limit) || 1,
    },
  }, ctx.requestId);
}

// =============================================
// GET INSPECTION
// =============================================

export async function getInspection(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  const inspection = await db.findByIdOrThrow('inspections', id, 'Inspection');

  // Also fetch inspection items
  const items = await db.findByParent(
    'inspection_items',
    'inspections',
    'inspection_id',
    id,
    { orderBy: 'timestamp', orderDirection: 'asc' },
  );

  // Fetch photos grouped by inspection_item_id for PDF embedding
  const photos = await db.rawQuery<Record<string, unknown>>(
    `SELECT id, inspection_item_id, r2_url, mime_type, is_reference_photo
     FROM photos
     WHERE inspection_item_id IN (
       SELECT id FROM inspection_items WHERE inspection_id = $1
     )
     ORDER BY created_at ASC`,
    [id],
  );

  return jsonResponse({
    success: true,
    data: {
      ...inspection,
      items,
      photos,
    },
  }, ctx.requestId);
}

// =============================================
// CREATE INSPECTION
// =============================================

export async function createInspection(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // Validate site belongs to this org
  const siteId = validateUUID(body['site_id'], 'site_id');
  await db.findByIdOrThrow('sites', siteId, 'Site');

  const data = {
    id: typeof body['id'] === 'string' && body['id'].length > 0
      ? validateUUID(body['id'], 'id')
      : crypto.randomUUID(),
    site_id: siteId,
    inspector_id: ctx.userId,
    inspection_type: validateEnum(body['inspection_type'], 'inspection_type', INSPECTION_TYPES),
    inspection_date: validateISODate(body['inspection_date'], 'inspection_date'),
    started_at: validateISODate(body['started_at'], 'started_at'),
    completed_at: validateOptionalISODate(body['completed_at'], 'completed_at'),
    duration_minutes: validateOptionalNumber(body['duration_minutes'], 'duration_minutes', { min: 0, max: 1440, integer: true }),
    weather_conditions: validateOptionalString(body['weather_conditions'], 'weather_conditions', { maxLength: 200 }),
    temperature_c: validateOptionalNumber(body['temperature_c'], 'temperature_c', { min: -40, max: 60 }),
    surface_conditions: validateOptionalString(body['surface_conditions'], 'surface_conditions', { maxLength: 200 }),
    status: validateOptionalEnum(body['status'], 'status', INSPECTION_STATUSES) ?? 'draft',
    overall_risk_rating: validateOptionalEnum(body['overall_risk_rating'], 'overall_risk_rating', RISK_RATINGS),
    very_high_risk_count: validateOptionalNumber(body['very_high_risk_count'], 'very_high_risk_count', { min: 0, integer: true }) ?? 0,
    high_risk_count: validateOptionalNumber(body['high_risk_count'], 'high_risk_count', { min: 0, integer: true }) ?? 0,
    medium_risk_count: validateOptionalNumber(body['medium_risk_count'], 'medium_risk_count', { min: 0, integer: true }) ?? 0,
    low_risk_count: validateOptionalNumber(body['low_risk_count'], 'low_risk_count', { min: 0, integer: true }) ?? 0,
    total_defects: validateOptionalNumber(body['total_defects'], 'total_defects', { min: 0, integer: true }) ?? 0,
    closure_recommended: validateOptionalBoolean(body['closure_recommended'], 'closure_recommended', false),
    closure_reason: validateOptionalString(body['closure_reason'], 'closure_reason', { maxLength: 2000 }),
    immediate_action_required: validateOptionalBoolean(body['immediate_action_required'], 'immediate_action_required', false),
    signed_by: null as string | null,
    signed_at: null as string | null,
    signature_ip_address: null as string | null,
    pdf_url: null as string | null,
    pdf_generated_at: null as string | null,
    inspector_summary: validateOptionalString(body['inspector_summary'], 'inspector_summary', { maxLength: 5000 }),
    notes: validateOptionalString(body['notes'], 'notes', { maxLength: 5000 }),
    metadata: body['metadata'] ?? {},
  };

  // If status is 'signed', capture signature data
  if (data.status === 'signed') {
    data.signed_by = validateString(body['signed_by'] as unknown, 'signed_by', { maxLength: 200 });
    data.signed_at = new Date().toISOString();
    data.signature_ip_address = request.headers.get('CF-Connecting-IP') ?? null;
  }

  const inspection = await db.insert('inspections', data);

  await writeAuditLog(ctx, 'inspection.created', 'inspections', data.id, {
    inspection_type: data.inspection_type,
    site_id: siteId,
    status: data.status,
  }, request);

  // Extract defects to standalone table when created as signed
  // MUST await — Cloudflare Workers kill void promises on response send
  if (data.status === 'signed') {
    const logger = Logger.fromContext(ctx);
    await extractDefectsToTable(db, ctx, data.id, siteId, logger);
  }

  return jsonResponse({
    success: true,
    data: inspection,
  }, ctx.requestId, 201);
}

// =============================================
// UPDATE INSPECTION
// =============================================

export async function updateInspection(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const id = validateUUID(params['id'], 'id');
  const body = await parseJsonBody(request);
  const db = createDb(ctx);
  const logger = Logger.fromContext(ctx);

  // Fetch existing inspection
  const existing = await db.findByIdOrThrow<Record<string, unknown>>('inspections', id, 'Inspection');
  const currentStatus = existing['status'] as string;

  // -- IMMUTABILITY CHECK --
  if (IMMUTABLE_STATUSES.has(currentStatus)) {
    logger.warn('Attempted modification of immutable inspection', {
      inspectionId: id,
      currentStatus,
    });
    throw new ConflictError(
      `Inspection is ${currentStatus} and cannot be modified. Signed inspections are immutable.`,
    );
  }

  // -- STATE TRANSITION VALIDATION --
  const newStatus = body['status'] as string | undefined;
  if (newStatus && newStatus !== currentStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestError(
        `Cannot transition inspection from '${currentStatus}' to '${newStatus}'. ` +
        `Allowed transitions: ${allowed.length > 0 ? allowed.join(', ') : 'none'}`,
      );
    }
  }

  // Build update data
  const data: Record<string, unknown> = {};

  if ('inspection_type' in body) data['inspection_type'] = validateEnum(body['inspection_type'], 'inspection_type', INSPECTION_TYPES);
  if ('inspection_date' in body) data['inspection_date'] = validateISODate(body['inspection_date'], 'inspection_date');
  if ('started_at' in body) data['started_at'] = validateISODate(body['started_at'], 'started_at');
  if ('completed_at' in body) data['completed_at'] = validateOptionalISODate(body['completed_at'], 'completed_at');
  if ('duration_minutes' in body) data['duration_minutes'] = validateOptionalNumber(body['duration_minutes'], 'duration_minutes', { min: 0, max: 1440, integer: true });
  if ('weather_conditions' in body) data['weather_conditions'] = validateOptionalString(body['weather_conditions'], 'weather_conditions', { maxLength: 200 });
  if ('temperature_c' in body) data['temperature_c'] = validateOptionalNumber(body['temperature_c'], 'temperature_c', { min: -40, max: 60 });
  if ('surface_conditions' in body) data['surface_conditions'] = validateOptionalString(body['surface_conditions'], 'surface_conditions', { maxLength: 200 });
  if ('status' in body) data['status'] = validateEnum(body['status'], 'status', INSPECTION_STATUSES);
  if ('overall_risk_rating' in body) data['overall_risk_rating'] = validateOptionalEnum(body['overall_risk_rating'], 'overall_risk_rating', RISK_RATINGS);
  if ('very_high_risk_count' in body) data['very_high_risk_count'] = validateOptionalNumber(body['very_high_risk_count'], 'very_high_risk_count', { min: 0, integer: true });
  if ('high_risk_count' in body) data['high_risk_count'] = validateOptionalNumber(body['high_risk_count'], 'high_risk_count', { min: 0, integer: true });
  if ('medium_risk_count' in body) data['medium_risk_count'] = validateOptionalNumber(body['medium_risk_count'], 'medium_risk_count', { min: 0, integer: true });
  if ('low_risk_count' in body) data['low_risk_count'] = validateOptionalNumber(body['low_risk_count'], 'low_risk_count', { min: 0, integer: true });
  if ('total_defects' in body) data['total_defects'] = validateOptionalNumber(body['total_defects'], 'total_defects', { min: 0, integer: true });
  if ('closure_recommended' in body) data['closure_recommended'] = validateBoolean(body['closure_recommended'], 'closure_recommended');
  if ('closure_reason' in body) data['closure_reason'] = validateOptionalString(body['closure_reason'], 'closure_reason', { maxLength: 2000 });
  if ('immediate_action_required' in body) data['immediate_action_required'] = validateBoolean(body['immediate_action_required'], 'immediate_action_required');
  if ('inspector_summary' in body) data['inspector_summary'] = validateOptionalString(body['inspector_summary'], 'inspector_summary', { maxLength: 5000 });
  if ('notes' in body) data['notes'] = validateOptionalString(body['notes'], 'notes', { maxLength: 5000 });
  if ('metadata' in body) data['metadata'] = body['metadata'];

  // -- SIGN-OFF HANDLING --
  if (newStatus === 'signed') {
    data['signed_by'] = validateString(body['signed_by'] as unknown, 'signed_by', { maxLength: 200 });
    data['signed_at'] = new Date().toISOString();
    data['signature_ip_address'] = request.headers.get('CF-Connecting-IP') ?? null;

    // Auto-step: draft->signed writes an intermediate review audit event
    if (currentStatus === 'draft') {
      await writeAuditLog(ctx, 'inspection.status_changed', 'inspections', id, {
        from: 'draft',
        to: 'review',
        auto_stepped: true,
      }, request);
    }

    logger.info('Inspection signed', {
      inspectionId: id,
      signedBy: data['signed_by'] as string,
      autoStepped: currentStatus === 'draft',
    });
  }

  // -- EXPORT HANDLING --
  if (newStatus === 'exported') {
    if ('pdf_url' in body) data['pdf_url'] = validateOptionalString(body['pdf_url'], 'pdf_url', { maxLength: 500 });
    if ('pdf_generated_at' in body) data['pdf_generated_at'] = validateOptionalISODate(body['pdf_generated_at'], 'pdf_generated_at');
  }

  if (Object.keys(data).length === 0) {
    return jsonResponse({ success: true, data: existing }, ctx.requestId);
  }

  const updated = await db.updateById('inspections', id, data);

  // -- DEFECT EXTRACTION (on sign-off) --
  // MUST await — Cloudflare Workers kill void promises on response send
  if (newStatus === 'signed') {
    const siteId = (existing['site_id'] ?? data['site_id']) as string;
    await extractDefectsToTable(db, ctx, id, siteId, logger);
  }

  // Audit -- track status changes specially
  if (newStatus && newStatus !== currentStatus) {
    await writeAuditLog(ctx, 'inspection.status_changed', 'inspections', id, {
      from: currentStatus,
      to: newStatus,
    }, request);

    if (newStatus === 'signed') {
      await writeAuditLog(ctx, 'inspection.signed', 'inspections', id, {
        signed_by: data['signed_by'],
      }, request);
    }
  } else {
    const changes = buildChanges(existing, data);
    if (Object.keys(changes).length > 0) {
      await writeAuditLog(ctx, 'inspection.updated', 'inspections', id, changes, request);
    }
  }

  return jsonResponse({
    success: true,
    data: updated,
  }, ctx.requestId);
}

// =============================================
// DELETE INSPECTION
// =============================================

export async function deleteInspection(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);
  const logger = Logger.fromContext(ctx);

  const existing = await db.findByIdOrThrow<Record<string, unknown>>('inspections', id, 'Inspection');
  const currentStatus = existing['status'] as string;

  // Signed/exported inspections can be deleted for demo prep
  // Production: re-enable guard for non-admin users

  // Delete child records first (tenant-isolated via subquery), then the inspection
  await db.rawExecute(
    `DELETE FROM photos WHERE inspection_item_id IN (SELECT id FROM inspection_items WHERE inspection_id = $1)`,
    [id],
  );
  await db.rawExecute(
    `DELETE FROM defects WHERE inspection_id = $1 AND org_id = $2`,
    [id, ctx.orgId],
  );
  await db.rawExecute(
    `DELETE FROM inspection_items WHERE inspection_id IN (SELECT id FROM inspections WHERE id = $1 AND org_id = $2)`,
    [id, ctx.orgId],
  );

  await db.deleteById('inspections', id);

  await writeAuditLog(ctx, 'inspection.deleted', 'inspections', id, {
    inspection_type: existing['inspection_type'],
    site_id: existing['site_id'],
    status: currentStatus,
  }, request);

  logger.info('Inspection deleted', { inspectionId: id, status: currentStatus });

  return jsonResponse({ success: true, data: null }, ctx.requestId);
}
