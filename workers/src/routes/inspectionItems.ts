/**
 * InspectVoice — Inspection Items Route Handler
 * CRUD endpoints for individual asset inspection results.
 *
 * Endpoints:
 *   GET    /api/v1/inspection-items/:inspectionId  — List items for an inspection
 *   POST   /api/v1/inspection-items                — Create item (from sync)
 *   PUT    /api/v1/inspection-items/:id            — Update item (from sync)
 *   GET    /api/v1/inspection-items/:id/ai-status  — Poll AI processing status
 *
 * Tenant isolation: inspection_items → inspections → org_id
 * Items for signed inspections are immutable (except AI processing updates).
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { writeAuditLog } from '../services/audit';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { ConflictError, NotFoundError } from '../shared/errors';
import {
  parseJsonBody,
  validateUUID,
  validateString,
  validateOptionalString,
  validateOptionalNumber,
  validateOptionalEnum,
  validateOptionalBoolean,
  validateOptionalLatitude,
  validateOptionalLongitude,
  validateISODate,
  validateArray,
} from '../shared/validation';
import { jsonResponse } from './helpers';

// =============================================
// ALLOWED VALUES
// =============================================

const CONDITION_RATINGS = ['good', 'fair', 'poor', 'dangerous'] as const;
const RISK_RATINGS = ['very_high', 'high', 'medium', 'low'] as const;
const ACTION_TIMEFRAMES = [
  'immediate', '48_hours', '1_week', '1_month', 'next_inspection', 'routine',
] as const;
const AI_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
const TRANSCRIPTION_METHODS = ['deepgram', 'web_speech_api', 'manual'] as const;

/** Columns that require explicit ::jsonb casting in parameterised queries */
const JSONB_COLUMNS = new Set(['defects', 'ai_analysis']);

// =============================================
// HELPER: Verify inspection belongs to org
// =============================================

async function verifyInspectionOwnership(
  db: ReturnType<typeof createDb>,
  inspectionId: string,
  orgId: string,
): Promise<Record<string, unknown>> {
  const rows = await db.rawQuery<Record<string, unknown>>(
    `SELECT i.* FROM inspections i WHERE i.org_id = $1 AND i.id = $2 LIMIT 1`,
    [orgId, inspectionId],
  );
  if (!rows[0]) {
    throw new NotFoundError('Inspection not found');
  }
  return rows[0];
}

/**
 * Verify an inspection item belongs to this org via the inspection chain.
 */
async function verifyItemOwnership(
  db: ReturnType<typeof createDb>,
  itemId: string,
  orgId: string,
): Promise<{ item: Record<string, unknown>; inspection: Record<string, unknown> }> {
  const rows = await db.rawQuery<Record<string, unknown>>(
    `SELECT ii.*, i.status AS inspection_status, i.org_id AS inspection_org_id
     FROM inspection_items ii
     INNER JOIN inspections i ON ii.inspection_id = i.id
     WHERE i.org_id = $1 AND ii.id = $2
     LIMIT 1`,
    [orgId, itemId],
  );

  if (!rows[0]) {
    throw new NotFoundError('Inspection item not found');
  }

  const row = rows[0];

  return {
    item: row,
    inspection: {
      status: row['inspection_status'],
      org_id: row['inspection_org_id'],
    },
  };
}

// =============================================
// LIST ITEMS FOR INSPECTION
// =============================================

export async function listInspectionItems(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const inspectionId = validateUUID(params['inspectionId'], 'inspectionId');
  const db = createDb(ctx);

  // Verify inspection belongs to this org
  await verifyInspectionOwnership(db, inspectionId, ctx.orgId);

  // Fetch items (no org_id on inspection_items — verified through inspection)
  const items = await db.rawQuery<Record<string, unknown>>(
    `SELECT ii.* FROM inspection_items ii
     INNER JOIN inspections i ON ii.inspection_id = i.id
     WHERE i.org_id = $1 AND ii.inspection_id = $2
     ORDER BY ii.timestamp ASC`,
    [ctx.orgId, inspectionId],
  );

  return jsonResponse({
    success: true,
    data: items,
  }, ctx.requestId);
}

// =============================================
// CREATE INSPECTION ITEM
// =============================================

export async function createInspectionItem(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // Validate and verify inspection ownership
  const inspectionId = validateUUID(body['inspection_id'], 'inspection_id');
  const inspection = await verifyInspectionOwnership(db, inspectionId, ctx.orgId);

  // Cannot add items to signed/exported inspections
  const inspectionStatus = inspection['status'] as string;
  if (inspectionStatus === 'signed' || inspectionStatus === 'exported') {
    throw new ConflictError('Cannot add items to a signed or exported inspection');
  }

  // Parse defects array if provided
  let defects: unknown[] = [];
  if (body['defects'] && Array.isArray(body['defects'])) {
    defects = validateArray(body['defects'], 'defects', { maxLength: 100 });
  }

  const data: Record<string, unknown> = {
    id: typeof body['id'] === 'string' && body['id'].length > 0
      ? validateUUID(body['id'], 'id')
      : crypto.randomUUID(),
    inspection_id: inspectionId,
    asset_id: body['asset_id'] ? validateUUID(body['asset_id'], 'asset_id') : null,
    asset_code: validateString(body['asset_code'], 'asset_code', { maxLength: 50 }),
    asset_type: validateString(body['asset_type'], 'asset_type', { maxLength: 50 }),
    audio_r2_key: null,
    voice_transcript: validateOptionalString(body['voice_transcript'], 'voice_transcript', { maxLength: 50000 }),
    transcription_method: validateOptionalEnum(body['transcription_method'], 'transcription_method', TRANSCRIPTION_METHODS),
    ai_analysis: body['ai_analysis'] ? JSON.stringify(body['ai_analysis']) : null,
    ai_model_version: validateOptionalString(body['ai_model_version'], 'ai_model_version', { maxLength: 50 }) ?? '',
    ai_processing_status: validateOptionalEnum(body['ai_processing_status'], 'ai_processing_status', AI_STATUSES) ?? 'pending',
    ai_processed_at: null,
    defects: JSON.stringify(defects),
    overall_condition: validateOptionalEnum(body['overall_condition'], 'overall_condition', CONDITION_RATINGS),
    risk_rating: validateOptionalEnum(body['risk_rating'], 'risk_rating', RISK_RATINGS),
    requires_action: validateOptionalBoolean(body['requires_action'], 'requires_action', false),
    action_timeframe: validateOptionalEnum(body['action_timeframe'], 'action_timeframe', ACTION_TIMEFRAMES),
    inspector_confirmed: validateOptionalBoolean(body['inspector_confirmed'], 'inspector_confirmed', false),
    inspector_notes: validateOptionalString(body['inspector_notes'], 'inspector_notes', { maxLength: 5000 }),
    inspector_risk_override: validateOptionalEnum(body['inspector_risk_override'], 'inspector_risk_override', RISK_RATINGS),
    latitude: validateOptionalLatitude(body['latitude'], 'latitude'),
    longitude: validateOptionalLongitude(body['longitude'], 'longitude'),
    timestamp: validateISODate(body['timestamp'], 'timestamp'),
    created_at: new Date().toISOString(),
  };

  // Insert — explicit ::jsonb cast for jsonb columns
  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = columns.map((col, i) =>
    JSONB_COLUMNS.has(col) ? `$${i + 1}::jsonb` : `$${i + 1}`
  );

  const insertSql = `INSERT INTO inspection_items (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *`;

  const rows = await db.rawQuery<Record<string, unknown>>(insertSql, values);

  void writeAuditLog(ctx, 'inspection_item.created', 'inspection_items', data['id'] as string, {
    inspection_id: inspectionId,
    asset_code: data['asset_code'],
    asset_type: data['asset_type'],
  }, request);

  return jsonResponse({
    success: true,
    data: rows[0],
  }, ctx.requestId, 201);
}

// =============================================
// UPDATE INSPECTION ITEM
// =============================================

export async function updateInspectionItem(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const id = validateUUID(params['id'], 'id');
  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // Verify ownership and get current state
  const { item: existing, inspection } = await verifyItemOwnership(db, id, ctx.orgId);
  const inspectionStatus = inspection['status'] as string;

  // Cannot modify items on signed/exported inspections
  // Exception: AI processing updates (the queue consumer needs to write results)
  const isAiUpdate = body['ai_processing_status'] !== undefined || body['ai_analysis'] !== undefined;
  if ((inspectionStatus === 'signed' || inspectionStatus === 'exported') && !isAiUpdate) {
    throw new ConflictError('Cannot modify items on a signed or exported inspection');
  }

  const data: Record<string, unknown> = {};

  if ('voice_transcript' in body) data['voice_transcript'] = validateOptionalString(body['voice_transcript'], 'voice_transcript', { maxLength: 50000 });
  if ('transcription_method' in body) data['transcription_method'] = validateOptionalEnum(body['transcription_method'], 'transcription_method', TRANSCRIPTION_METHODS);
  if ('ai_analysis' in body) data['ai_analysis'] = body['ai_analysis'] ? JSON.stringify(body['ai_analysis']) : null;
  if ('ai_model_version' in body) data['ai_model_version'] = validateOptionalString(body['ai_model_version'], 'ai_model_version', { maxLength: 50 });
  if ('ai_processing_status' in body) data['ai_processing_status'] = validateOptionalEnum(body['ai_processing_status'], 'ai_processing_status', AI_STATUSES);
  if ('ai_processed_at' in body) data['ai_processed_at'] = body['ai_processed_at'];
  if ('defects' in body) data['defects'] = JSON.stringify(body['defects'] ?? []);
  if ('overall_condition' in body) data['overall_condition'] = validateOptionalEnum(body['overall_condition'], 'overall_condition', CONDITION_RATINGS);
  if ('risk_rating' in body) data['risk_rating'] = validateOptionalEnum(body['risk_rating'], 'risk_rating', RISK_RATINGS);
  if ('requires_action' in body) data['requires_action'] = validateOptionalBoolean(body['requires_action'], 'requires_action', false);
  if ('action_timeframe' in body) data['action_timeframe'] = validateOptionalEnum(body['action_timeframe'], 'action_timeframe', ACTION_TIMEFRAMES);
  if ('inspector_confirmed' in body) data['inspector_confirmed'] = validateOptionalBoolean(body['inspector_confirmed'], 'inspector_confirmed', false);
  if ('inspector_notes' in body) data['inspector_notes'] = validateOptionalString(body['inspector_notes'], 'inspector_notes', { maxLength: 5000 });
  if ('inspector_risk_override' in body) data['inspector_risk_override'] = validateOptionalEnum(body['inspector_risk_override'], 'inspector_risk_override', RISK_RATINGS);
  if ('audio_r2_key' in body) data['audio_r2_key'] = validateOptionalString(body['audio_r2_key'], 'audio_r2_key', { maxLength: 500 });

  if (Object.keys(data).length === 0) {
    return jsonResponse({ success: true, data: existing }, ctx.requestId);
  }

  // Update — explicit ::jsonb cast for jsonb columns
  const setClauses = Object.keys(data).map((col, i) =>
    JSONB_COLUMNS.has(col) ? `${col} = $${i + 1}::jsonb` : `${col} = $${i + 1}`
  );
  const updateSql = `UPDATE inspection_items SET ${setClauses.join(', ')}
    WHERE id = $${Object.keys(data).length + 1}
    RETURNING *`;

  const rows = await db.rawQuery<Record<string, unknown>>(
    updateSql,
    [...Object.values(data), id],
  );

  if (isAiUpdate) {
    void writeAuditLog(ctx, 'inspection_item.ai_processed', 'inspection_items', id, {
      ai_processing_status: data['ai_processing_status'],
    }, request);
  } else {
    void writeAuditLog(ctx, 'inspection_item.updated', 'inspection_items', id, null, request);
  }

  return jsonResponse({
    success: true,
    data: rows[0] ?? existing,
  }, ctx.requestId);
}

// =============================================
// POLL AI STATUS
// =============================================

export async function getAiStatus(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  const { item } = await verifyItemOwnership(db, id, ctx.orgId);

  return jsonResponse({
    success: true,
    data: {
      id,
      ai_processing_status: item['ai_processing_status'],
      ai_model_version: item['ai_model_version'],
      ai_processed_at: item['ai_processed_at'],
      ai_analysis: item['ai_analysis'],
    },
  }, ctx.requestId);
}
