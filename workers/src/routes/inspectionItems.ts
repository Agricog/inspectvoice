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
 * Items for signed inspections are immutable (except AI processing updates
 * and initial sync from the offline-first client).
 *
 * FIX: 3 Mar 2026
 *   - Defensive asset auto-creation: if the FK constraint on asset_id fails
 *     because the asset hasn't synced yet, the server creates a minimal asset
 *     record using asset_code, asset_type, and the inspection's site_id.
 *     This prevents cascading sync failures in the offline-first workflow.
 *   - ensureAssetExists now includes org_id in the INSERT — the assets table
 *     has a NOT NULL org_id column, so omitting it caused the insert to fail
 *     silently, leaving the FK violation unresolved.
 *   - Relaxed signed-inspection guard for item creation: in the offline-first
 *     workflow, the inspection syncs (possibly already as signed) before items
 *     arrive. Blocking item creation on signed inspections broke the sync
 *     pipeline. Items are now allowed through on creation; updates to signed
 *     inspections remain blocked (except AI processing).
 *   - Per-item defect extraction: when an item with defects arrives for a
 *     signed inspection, defects are extracted to the defects table inline.
 *     This solves the offline-first timing issue where the sign-off extraction
 *     ran before items existed on the server. Self-contained — no cross-file
 *     imports from inspections.ts.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { writeAuditLog } from '../services/audit';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { ConflictError, NotFoundError } from '../shared/errors';
import { Logger } from '../shared/logger';
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

/**
 * Ensure an asset exists on the server. If the FK constraint would fail
 * because the asset was created locally but never synced, auto-create a
 * minimal asset record using data from the inspection item payload.
 *
 * This is a defensive measure for offline-first sync ordering issues.
 * The asset record will be updated with full details when the asset
 * sync eventually succeeds (upsert pattern).
 *
 * FIX: org_id is now included in the INSERT. The assets table has a
 * NOT NULL org_id column — omitting it caused the INSERT to fail
 * silently (caught by try-catch), leaving the FK violation unresolved.
 */
async function ensureAssetExists(
  db: ReturnType<typeof createDb>,
  assetId: string,
  assetCode: string,
  assetType: string,
  siteId: string,
  orgId: string,
  logger: Logger,
): Promise<void> {
  // Check if asset already exists (fast path)
  const existing = await db.rawQuery<Record<string, unknown>>(
    `SELECT id FROM assets WHERE id = $1 LIMIT 1`,
    [assetId],
  );

  if (existing.length > 0) return;

  // Asset doesn't exist — create a minimal record including org_id
  const now = new Date().toISOString();
  try {
    await db.rawQuery(
      `INSERT INTO assets (id, org_id, site_id, asset_code, asset_type, asset_category, is_active, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'other', true, '{}'::jsonb, $6, $6)
       ON CONFLICT (id) DO NOTHING`,
      [assetId, orgId, siteId, assetCode, assetType, now],
    );

    logger.info('Auto-created missing asset for sync', {
      assetId,
      assetCode,
      assetType,
      siteId,
      orgId,
    });
  } catch (insertError) {
    // If this also fails (e.g. site doesn't exist), let the original
    // FK violation bubble up — it's a deeper data integrity issue
    logger.error('Failed to auto-create asset', {
      assetId,
      error: insertError instanceof Error ? insertError.message : String(insertError),
    });
  }
}

// =============================================
// HELPER: Calculate due date from timeframe
// =============================================

/** Map action_timeframe to a concrete due date relative to now. */
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
      return null; // next_inspection, routine — no fixed date
  }
}

// =============================================
// HELPER: Extract defects from a single item
// =============================================

/**
 * Extract defects from a newly-synced inspection item into the standalone
 * defects table. Called when an item with defects arrives for an
 * already-signed inspection.
 *
 * WHY THIS EXISTS:
 * In the offline-first workflow the inspection signs off locally and syncs
 * first. The sign-off extraction in inspections.ts runs but finds no items
 * (they haven't synced yet). This function is the second chance — it runs
 * per-item as items arrive, ensuring defects always reach the defects table
 * regardless of sync ordering.
 *
 * SAFETY:
 *   - Fire-and-forget: wrapped in try-catch so extraction failure never
 *     blocks the item creation response.
 *   - Idempotent: checks for existing defects with the same
 *     inspection_item_id + description before inserting.
 *   - Self-contained: no cross-file imports. Duplicates the
 *     calculateDueDate logic from inspections.ts deliberately to avoid
 *     coupling between route handlers.
 */
async function extractItemDefects(
  db: ReturnType<typeof createDb>,
  ctx: RequestContext,
  inspectionId: string,
  siteId: string,
  itemId: string,
  assetId: string | null,
  defects: unknown[],
  logger: Logger,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    let extractedCount = 0;

    for (const raw of defects) {
      const defect = raw as Record<string, unknown>;
      const description = (defect['description'] as string) ?? '';
      if (!description) continue;

      const dueDate = calculateDueDate(defect['action_timeframe'] as string | undefined);

      // Idempotency guard: skip if this exact defect was already extracted
      // (e.g. by the sign-off extraction in inspections.ts on a retry)
      const exists = await db.rawQuery<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM defects
         WHERE inspection_item_id = $1 AND description = $2`,
        [itemId, description],
      );

      if ((exists[0]?.count ?? 0) > 0) continue;

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
          crypto.randomUUID(),                                     // id
          ctx.orgId,                                               // org_id
          itemId,                                                  // inspection_item_id
          inspectionId,                                            // inspection_id
          siteId,                                                  // site_id
          assetId,                                                 // asset_id
          description,                                             // description
          (defect['bs_en_reference'] as string) ?? null,           // bs_en_reference
          (defect['risk_rating'] as string) ?? 'medium',           // severity
          (defect['remedial_action'] as string) ?? '',             // remedial_action
          (defect['action_timeframe'] as string) ?? 'routine',     // action_timeframe
          'open',                                                  // status
          'inspection',                                            // source
          (defect['estimated_cost_band'] as string) ?? null,       // estimated_cost_gbp
          dueDate,                                                 // due_date
          false,                                                   // made_safe
          false,                                                   // asset_closed
          JSON.stringify({ extracted_from: 'item_sync', original: defect }), // metadata
          now,                                                     // created_at
          now,                                                     // updated_at
        ],
      );
      extractedCount++;
    }

    if (extractedCount > 0) {
      logger.info('Defects extracted from synced item', {
        inspectionId,
        itemId,
        count: extractedCount,
      });

      void writeAuditLog(
        ctx,
        'defects.extracted' as Parameters<typeof writeAuditLog>[1],
        'inspection_items',
        itemId,
        { count: extractedCount, source: 'item_sync' },
      );
    }
  } catch (err) {
    // Never block item creation — log and move on
    logger.error('Failed to extract defects from item', {
      itemId,
      inspectionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
  const logger = Logger.fromContext(ctx);

  // Validate and verify inspection ownership
  const inspectionId = validateUUID(body['inspection_id'], 'inspection_id');
  const inspection = await verifyInspectionOwnership(db, inspectionId, ctx.orgId);

  // Offline-first sync: items may arrive AFTER the inspection has been signed.
  // The client completes capture + sign-off locally, then syncs in order:
  //   1. Inspection (arrives as 'signed')
  //   2. Inspection items (arrive after — must be allowed through)
  //
  // We only block item creation for 'exported' inspections, which indicates
  // the inspection has been fully finalised and distributed. Updates to
  // signed inspection items remain blocked (see updateInspectionItem).
  const inspectionStatus = inspection['status'] as string;
  if (inspectionStatus === 'exported') {
    throw new ConflictError('Cannot add items to an exported inspection');
  }

  // Parse defects array if provided
  let defects: unknown[] = [];
  if (body['defects'] && Array.isArray(body['defects'])) {
    defects = validateArray(body['defects'], 'defects', { maxLength: 100 });
  }

  const assetId = body['asset_id'] ? validateUUID(body['asset_id'], 'asset_id') : null;
  const assetCode = validateString(body['asset_code'], 'asset_code', { maxLength: 50 });
  const assetType = validateString(body['asset_type'], 'asset_type', { maxLength: 50 });
  const siteId = inspection['site_id'] as string;

  // Defensive: ensure asset exists before inserting the item.
  // If the offline client created the asset locally but sync hasn't
  // reached the server yet, auto-create a minimal asset record.
  if (assetId) {
    await ensureAssetExists(db, assetId, assetCode, assetType, siteId, ctx.orgId, logger);
  }

  const data: Record<string, unknown> = {
    id: typeof body['id'] === 'string' && body['id'].length > 0
      ? validateUUID(body['id'], 'id')
      : crypto.randomUUID(),
    inspection_id: inspectionId,
    asset_id: assetId,
    asset_code: assetCode,
    asset_type: assetType,
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

  // ── Defect extraction for signed inspections ──────────────────────
  // In offline-first sync, the inspection arrives signed before items sync.
  // The sign-off extraction in inspections.ts found no items and extracted
  // nothing. Now that this item has landed with defects, extract them
  // immediately so the Defect Tracker is always up to date.
  // Fire-and-forget: never blocks the response to the client.
  if (inspectionStatus === 'signed' && defects.length > 0) {
    void extractItemDefects(
      db, ctx, inspectionId, siteId,
      data['id'] as string, assetId,
      defects, logger,
    );
  }

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
  if ('ai_model_version' in body) data['ai_model_version'] = validateOptionalString(body['ai_model_version'], 'ai_model_version', { maxLength: 50 }) ?? '';
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
