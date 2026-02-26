/**
 * InspectVoice — Manufacturer Recall Routes (Feature 17)
 * workers/src/routes/recalls.ts
 *
 * CRUD for manufacturer recalls + deterministic matching engine
 * + acknowledgement/action workflow with audit logging.
 *
 * Matching is explainable: match_reason stored for every matched asset
 * so results are defensible in disputes.
 *
 * RBAC: manager/admin can create/edit/resolve recalls.
 *       All authenticated members can view recalls + matches.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon } from '@neondatabase/serverless';
import type { RequestContext, RouteParams } from '../types';
import { formatErrorResponse, ForbiddenError, NotFoundError, BadRequestError } from '../shared/errors';
import { Logger } from '../shared/logger';
import { validateRequiredString } from '../shared/validation';
import { parsePagination } from '../shared/pagination';

// =============================================
// TYPES
// =============================================

interface RecallRow {
  readonly id: string;
  readonly org_id: string;
  readonly title: string;
  readonly manufacturer: string;
  readonly affected_models: readonly string[];
  readonly severity: string;
  readonly description: string;
  readonly source_url: string | null;
  readonly source_reference: string | null;
  readonly published_date: string | null;
  readonly status: string;
  readonly resolved_at: string | null;
  readonly resolved_by: string | null;
  readonly resolution_notes: string | null;
  readonly matched_asset_count: number;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface MatchRow {
  readonly id: string;
  readonly org_id: string;
  readonly recall_id: string;
  readonly asset_id: string;
  readonly site_id: string;
  readonly match_reason: string;
  readonly match_confidence: string;
  readonly status: string;
  readonly acknowledged_by: string | null;
  readonly acknowledged_at: string | null;
  readonly action_taken: string | null;
  readonly action_taken_by: string | null;
  readonly action_taken_at: string | null;
  readonly notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  // Joined fields
  readonly asset_code?: string;
  readonly asset_type?: string;
  readonly asset_manufacturer?: string;
  readonly asset_model?: string;
  readonly site_name?: string;
  readonly recall_title?: string;
  readonly recall_severity?: string;
  readonly recall_manufacturer?: string;
}

interface AssetForMatching {
  readonly id: string;
  readonly site_id: string;
  readonly asset_code: string;
  readonly asset_type: string;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly is_active: boolean;
}

interface MatchResult {
  readonly assetId: string;
  readonly siteId: string;
  readonly reason: string;
  readonly confidence: 'exact' | 'partial';
}

// =============================================
// HELPERS
// =============================================

function requireManagerOrAdmin(ctx: RequestContext): void {
  const role = ctx.userRole.replace('org:', '');
  if (role !== 'manager' && role !== 'admin') {
    throw new ForbiddenError('Manager or admin role required');
  }
}

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'advisory'] as const;
const VALID_STATUSES = ['active', 'resolved', 'dismissed'] as const;
const VALID_MATCH_STATUSES = [
  'unacknowledged', 'acknowledged', 'inspected', 'withdrawn', 'replaced', 'not_affected',
] as const;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================
// MATCHING ENGINE — deterministic + explainable
// =============================================

/**
 * Runs deterministic matching of a recall against all org assets.
 * Returns matches with explainable match_reason for each.
 *
 * Matching logic:
 * 1. Filter assets by manufacturer (case-insensitive, trimmed)
 * 2. If affected_models is non-empty, further filter by model pattern matching
 * 3. match_reason captures exactly why this asset matched
 */
function matchRecallToAssets(
  manufacturer: string,
  affectedModels: readonly string[],
  assets: readonly AssetForMatching[],
): MatchResult[] {
  const results: MatchResult[] = [];
  const recallMfr = manufacturer.trim().toLowerCase();

  for (const asset of assets) {
    if (!asset.is_active) continue;

    const assetMfr = (asset.manufacturer ?? '').trim().toLowerCase();
    if (!assetMfr) continue;

    // Step 1: Manufacturer match
    const mfrExact = assetMfr === recallMfr;
    const mfrPartial = !mfrExact && (assetMfr.includes(recallMfr) || recallMfr.includes(assetMfr));

    if (!mfrExact && !mfrPartial) continue;

    const mfrReason = mfrExact
      ? `Manufacturer '${asset.manufacturer}' exact match`
      : `Manufacturer '${asset.manufacturer}' partial match with '${manufacturer}'`;

    // Step 2: Model matching (if patterns specified)
    if (affectedModels.length > 0) {
      const assetModel = (asset.model ?? '').trim().toLowerCase();

      if (!assetModel) {
        // Asset has no model — match on manufacturer alone with partial confidence
        results.push({
          assetId: asset.id,
          siteId: asset.site_id,
          reason: `${mfrReason}. Asset model not recorded — manual verification recommended.`,
          confidence: 'partial',
        });
        continue;
      }

      let modelMatched = false;
      let modelReason = '';

      for (const pattern of affectedModels) {
        const normPattern = pattern.trim().toLowerCase();
        if (!normPattern) continue;

        if (normPattern.endsWith('*')) {
          // Wildcard prefix match: "MultiPlay*" matches "multiplay 200"
          const prefix = normPattern.slice(0, -1);
          if (assetModel.startsWith(prefix)) {
            modelMatched = true;
            modelReason = `Model '${asset.model}' matches pattern '${pattern}' (prefix)`;
            break;
          }
        } else if (normPattern.startsWith('*')) {
          // Wildcard suffix match: "*200" matches "MultiPlay 200"
          const suffix = normPattern.slice(1);
          if (assetModel.endsWith(suffix)) {
            modelMatched = true;
            modelReason = `Model '${asset.model}' matches pattern '${pattern}' (suffix)`;
            break;
          }
        } else if (assetModel === normPattern) {
          // Exact model match
          modelMatched = true;
          modelReason = `Model '${asset.model}' exact match with '${pattern}'`;
          break;
        } else if (assetModel.includes(normPattern) || normPattern.includes(assetModel)) {
          // Contains match
          modelMatched = true;
          modelReason = `Model '${asset.model}' partial match with '${pattern}'`;
          break;
        }
      }

      if (!modelMatched) continue;

      const confidence = mfrExact && modelReason.includes('exact') ? 'exact' : 'partial';
      results.push({
        assetId: asset.id,
        siteId: asset.site_id,
        reason: `${mfrReason}. ${modelReason}.`,
        confidence,
      });
    } else {
      // No model patterns — match all assets from this manufacturer
      results.push({
        assetId: asset.id,
        siteId: asset.site_id,
        reason: `${mfrReason}. No specific models listed — all models from this manufacturer affected.`,
        confidence: mfrExact ? 'exact' : 'partial',
      });
    }
  }

  return results;
}

// =============================================
// LIST RECALLS
// =============================================

export async function listRecalls(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  const logger = Logger.fromContext(ctx);

  try {
    const sql = neon(ctx.env.DATABASE_URL);
    const url = new URL(request.url);
    const { limit, offset } = parsePagination(url.searchParams);
    const statusFilter = url.searchParams.get('status');

    let query: string;
    let countQuery: string;
    const queryParams: (string | number)[] = [ctx.orgId];

    if (statusFilter && VALID_STATUSES.includes(statusFilter as typeof VALID_STATUSES[number])) {
      query = `
        SELECT * FROM manufacturer_recalls
        WHERE org_id = $1 AND status = $2
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'advisory' THEN 4
          END,
          created_at DESC
        LIMIT $3 OFFSET $4
      `;
      countQuery = `SELECT COUNT(*) as total FROM manufacturer_recalls WHERE org_id = $1 AND status = $2`;
      queryParams.push(statusFilter, limit, offset);
    } else {
      query = `
        SELECT * FROM manufacturer_recalls
        WHERE org_id = $1
        ORDER BY
          CASE status WHEN 'active' THEN 0 ELSE 1 END,
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'advisory' THEN 4
          END,
          created_at DESC
        LIMIT $2 OFFSET $3
      `;
      countQuery = `SELECT COUNT(*) as total FROM manufacturer_recalls WHERE org_id = $1`;
      queryParams.push(limit, offset);
    }

    const [rows, countRows] = await Promise.all([
      sql(query, queryParams) as Promise<RecallRow[]>,
      sql(countQuery, statusFilter ? [ctx.orgId, statusFilter] : [ctx.orgId]) as Promise<Array<{ total: string }>>,
    ]);

    const total = parseInt(countRows[0]?.total ?? '0', 10);

    return jsonResponse({
      success: true,
      data: rows,
      pagination: { total, limit, offset },
      requestId: ctx.requestId,
    });
  } catch (error) {
    logger.error('Failed to list recalls', { error });
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// GET RECALL (with matches)
// =============================================

export async function getRecall(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  const logger = Logger.fromContext(ctx);
  const recallId = params['id'];
  if (!recallId) throw new BadRequestError('Missing recall ID');

  try {
    const sql = neon(ctx.env.DATABASE_URL);

    const [recallRows, matchRows] = await Promise.all([
      sql`
        SELECT * FROM manufacturer_recalls
        WHERE id = ${recallId} AND org_id = ${ctx.orgId}
      ` as Promise<RecallRow[]>,
      sql`
        SELECT
          ram.*,
          a.asset_code,
          a.asset_type,
          a.manufacturer AS asset_manufacturer,
          a.model AS asset_model,
          s.name AS site_name
        FROM recall_asset_matches ram
        JOIN assets a ON a.id = ram.asset_id
        JOIN sites s ON s.id = ram.site_id
        WHERE ram.recall_id = ${recallId} AND ram.org_id = ${ctx.orgId}
        ORDER BY
          CASE ram.status WHEN 'unacknowledged' THEN 0 ELSE 1 END,
          ram.created_at DESC
      ` as Promise<MatchRow[]>,
    ]);

    const recall = recallRows[0];
    if (!recall) throw new NotFoundError('Recall not found');

    return jsonResponse({
      success: true,
      data: { ...recall, matches: matchRows },
      requestId: ctx.requestId,
    });
  } catch (error) {
    logger.error('Failed to get recall', { error, recallId });
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// CREATE RECALL + RUN MATCHING
// =============================================

export async function createRecall(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireManagerOrAdmin(ctx);
  const logger = Logger.fromContext(ctx);

  try {
    const body = await request.json() as Record<string, unknown>;
    const sql = neon(ctx.env.DATABASE_URL);

    // Validate required fields
    const title = validateRequiredString(body['title'] as string | undefined, 'title');
    const manufacturer = validateRequiredString(body['manufacturer'] as string | undefined, 'manufacturer');
    const description = validateRequiredString(body['description'] as string | undefined, 'description');
    const severity = (body['severity'] as string) ?? 'medium';
    if (!VALID_SEVERITIES.includes(severity as typeof VALID_SEVERITIES[number])) {
      throw new BadRequestError(`Invalid severity: ${severity}`);
    }

    const affectedModels = Array.isArray(body['affected_models'])
      ? (body['affected_models'] as string[]).filter((m) => typeof m === 'string' && m.trim())
      : [];
    const sourceUrl = typeof body['source_url'] === 'string' ? body['source_url'] : null;
    const sourceReference = typeof body['source_reference'] === 'string' ? body['source_reference'] : null;
    const publishedDate = typeof body['published_date'] === 'string' ? body['published_date'] : null;

    // 1. Insert recall
    const recallRows = await sql`
      INSERT INTO manufacturer_recalls (
        org_id, title, manufacturer, affected_models, severity,
        description, source_url, source_reference, published_date,
        status, created_by
      ) VALUES (
        ${ctx.orgId}, ${title}, ${manufacturer}, ${affectedModels},
        ${severity}, ${description}, ${sourceUrl}, ${sourceReference},
        ${publishedDate}, 'active', ${ctx.userId}
      )
      RETURNING *
    ` as RecallRow[];

    const recall = recallRows[0];
    if (!recall) throw new Error('Failed to insert recall');

    // 2. Load all org assets for matching
    const assets = await sql`
      SELECT id, site_id, asset_code, asset_type, manufacturer, model, is_active
      FROM assets
      WHERE org_id = ${ctx.orgId}
    ` as AssetForMatching[];

    // 3. Run deterministic matching
    const matches = matchRecallToAssets(manufacturer, affectedModels, assets);

    // 4. Insert matches
    if (matches.length > 0) {
      const values = matches.map((m) =>
        `('${ctx.orgId}', '${recall.id}', '${m.assetId}', '${m.siteId}', '${m.reason.replace(/'/g, "''")}', '${m.confidence}')`
      ).join(',\n');

      await sql(`
        INSERT INTO recall_asset_matches (org_id, recall_id, asset_id, site_id, match_reason, match_confidence)
        VALUES ${values}
        ON CONFLICT (recall_id, asset_id) DO NOTHING
      `);

      // Update matched count
      await sql`
        UPDATE manufacturer_recalls
        SET matched_asset_count = ${matches.length}
        WHERE id = ${recall.id}
      `;
    }

    // 5. Audit log
    await sql`
      INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
      VALUES (
        ${ctx.orgId}, ${ctx.userId}, 'recall_created', 'manufacturer_recall', ${recall.id},
        ${JSON.stringify({ title, manufacturer, severity, matched_assets: matches.length })},
        NOW()
      )
    `;

    logger.info('Recall created', {
      recallId: recall.id,
      manufacturer,
      matchedAssets: matches.length,
    });

    return jsonResponse({
      success: true,
      data: { ...recall, matched_asset_count: matches.length, matches },
      requestId: ctx.requestId,
    }, 201);
  } catch (error) {
    logger.error('Failed to create recall', { error });
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// UPDATE RECALL + RE-RUN MATCHING
// =============================================

export async function updateRecall(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireManagerOrAdmin(ctx);
  const logger = Logger.fromContext(ctx);
  const recallId = params['id'];
  if (!recallId) throw new BadRequestError('Missing recall ID');

  try {
    const body = await request.json() as Record<string, unknown>;
    const sql = neon(ctx.env.DATABASE_URL);

    // Verify recall exists and belongs to org
    const existing = await sql`
      SELECT * FROM manufacturer_recalls WHERE id = ${recallId} AND org_id = ${ctx.orgId}
    ` as RecallRow[];
    if (!existing[0]) throw new NotFoundError('Recall not found');

    const title = typeof body['title'] === 'string' ? body['title'] : existing[0].title;
    const manufacturer = typeof body['manufacturer'] === 'string' ? body['manufacturer'] : existing[0].manufacturer;
    const description = typeof body['description'] === 'string' ? body['description'] : existing[0].description;
    const severity = typeof body['severity'] === 'string' ? body['severity'] : existing[0].severity;
    const status = typeof body['status'] === 'string' ? body['status'] : existing[0].status;
    const affectedModels = Array.isArray(body['affected_models'])
      ? (body['affected_models'] as string[]).filter((m) => typeof m === 'string' && m.trim())
      : [...existing[0].affected_models];
    const sourceUrl = typeof body['source_url'] === 'string' ? body['source_url'] : existing[0].source_url;
    const sourceReference = typeof body['source_reference'] === 'string' ? body['source_reference'] : existing[0].source_reference;
    const publishedDate = typeof body['published_date'] === 'string' ? body['published_date'] : existing[0].published_date;
    const resolutionNotes = typeof body['resolution_notes'] === 'string' ? body['resolution_notes'] : existing[0].resolution_notes;

    // Handle resolve/dismiss
    const resolvedAt = status !== 'active' && !existing[0].resolved_at ? new Date().toISOString() : existing[0].resolved_at;
    const resolvedBy = status !== 'active' && !existing[0].resolved_by ? ctx.userId : existing[0].resolved_by;

    await sql`
      UPDATE manufacturer_recalls SET
        title = ${title},
        manufacturer = ${manufacturer},
        affected_models = ${affectedModels},
        severity = ${severity},
        description = ${description},
        source_url = ${sourceUrl},
        source_reference = ${sourceReference},
        published_date = ${publishedDate},
        status = ${status},
        resolved_at = ${resolvedAt},
        resolved_by = ${resolvedBy},
        resolution_notes = ${resolutionNotes}
      WHERE id = ${recallId} AND org_id = ${ctx.orgId}
    `;

    // Re-run matching if manufacturer or models changed
    const mfrChanged = manufacturer.toLowerCase() !== existing[0].manufacturer.toLowerCase();
    const modelsChanged = JSON.stringify(affectedModels) !== JSON.stringify(existing[0].affected_models);

    let matchCount = existing[0].matched_asset_count;

    if (mfrChanged || modelsChanged) {
      // Delete old matches and re-run
      await sql`DELETE FROM recall_asset_matches WHERE recall_id = ${recallId}`;

      const assets = await sql`
        SELECT id, site_id, asset_code, asset_type, manufacturer, model, is_active
        FROM assets WHERE org_id = ${ctx.orgId}
      ` as AssetForMatching[];

      const matches = matchRecallToAssets(manufacturer, affectedModels, assets);
      matchCount = matches.length;

      if (matches.length > 0) {
        const values = matches.map((m) =>
          `('${ctx.orgId}', '${recallId}', '${m.assetId}', '${m.siteId}', '${m.reason.replace(/'/g, "''")}', '${m.confidence}')`
        ).join(',\n');

        await sql(`
          INSERT INTO recall_asset_matches (org_id, recall_id, asset_id, site_id, match_reason, match_confidence)
          VALUES ${values}
          ON CONFLICT (recall_id, asset_id) DO NOTHING
        `);
      }

      await sql`
        UPDATE manufacturer_recalls SET matched_asset_count = ${matchCount} WHERE id = ${recallId}
      `;
    }

    // Audit log
    await sql`
      INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
      VALUES (
        ${ctx.orgId}, ${ctx.userId}, 'recall_updated', 'manufacturer_recall', ${recallId},
        ${JSON.stringify({ title, manufacturer, severity, status, rematched: mfrChanged || modelsChanged })},
        NOW()
      )
    `;

    logger.info('Recall updated', { recallId, rematched: mfrChanged || modelsChanged, matchCount });

    return jsonResponse({
      success: true,
      data: { id: recallId, matched_asset_count: matchCount },
      requestId: ctx.requestId,
    });
  } catch (error) {
    logger.error('Failed to update recall', { error, recallId });
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// ACKNOWLEDGE / ACTION A MATCH
// =============================================

export async function updateRecallMatch(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  const logger = Logger.fromContext(ctx);
  const matchId = params['matchId'];
  if (!matchId) throw new BadRequestError('Missing match ID');

  try {
    const body = await request.json() as Record<string, unknown>;
    const sql = neon(ctx.env.DATABASE_URL);

    // Verify match exists
    const existingRows = await sql`
      SELECT * FROM recall_asset_matches WHERE id = ${matchId} AND org_id = ${ctx.orgId}
    ` as MatchRow[];
    const existing = existingRows[0];
    if (!existing) throw new NotFoundError('Recall match not found');

    const newStatus = typeof body['status'] === 'string' ? body['status'] : existing.status;
    if (!VALID_MATCH_STATUSES.includes(newStatus as typeof VALID_MATCH_STATUSES[number])) {
      throw new BadRequestError(`Invalid match status: ${newStatus}`);
    }

    const actionTaken = typeof body['action_taken'] === 'string' ? body['action_taken'] : existing.action_taken;
    const notes = typeof body['notes'] === 'string' ? body['notes'] : existing.notes;

    // Auto-set acknowledgement fields
    const acknowledgedAt = newStatus !== 'unacknowledged' && !existing.acknowledged_at
      ? new Date().toISOString()
      : existing.acknowledged_at;
    const acknowledgedBy = newStatus !== 'unacknowledged' && !existing.acknowledged_by
      ? ctx.userId
      : existing.acknowledged_by;

    // Auto-set action fields if action provided
    const actionTakenAt = actionTaken && !existing.action_taken_at
      ? new Date().toISOString()
      : existing.action_taken_at;
    const actionTakenBy = actionTaken && !existing.action_taken_by
      ? ctx.userId
      : existing.action_taken_by;

    await sql`
      UPDATE recall_asset_matches SET
        status = ${newStatus},
        acknowledged_by = ${acknowledgedBy},
        acknowledged_at = ${acknowledgedAt},
        action_taken = ${actionTaken},
        action_taken_by = ${actionTakenBy},
        action_taken_at = ${actionTakenAt},
        notes = ${notes}
      WHERE id = ${matchId} AND org_id = ${ctx.orgId}
    `;

    // Audit log
    await sql`
      INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
      VALUES (
        ${ctx.orgId}, ${ctx.userId}, 'recall_match_actioned', 'recall_asset_match', ${matchId},
        ${JSON.stringify({ recall_id: existing.recall_id, asset_id: existing.asset_id, old_status: existing.status, new_status: newStatus, action_taken: actionTaken })},
        NOW()
      )
    `;

    logger.info('Recall match updated', { matchId, newStatus, actionTaken });

    return jsonResponse({
      success: true,
      data: { id: matchId, status: newStatus },
      requestId: ctx.requestId,
    });
  } catch (error) {
    logger.error('Failed to update recall match', { error, matchId });
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// GET ACTIVE RECALL ALERTS (for dashboard banner)
// =============================================

export async function getActiveRecallAlerts(
  _request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  const logger = Logger.fromContext(ctx);

  try {
    const sql = neon(ctx.env.DATABASE_URL);

    // Active recalls with unacknowledged match count
    const rows = await sql`
      SELECT
        mr.id,
        mr.title,
        mr.manufacturer,
        mr.severity,
        mr.matched_asset_count,
        mr.created_at,
        COUNT(ram.id) FILTER (WHERE ram.status = 'unacknowledged') AS unacknowledged_count
      FROM manufacturer_recalls mr
      LEFT JOIN recall_asset_matches ram ON ram.recall_id = mr.id
      WHERE mr.org_id = ${ctx.orgId}
        AND mr.status = 'active'
        AND mr.matched_asset_count > 0
      GROUP BY mr.id
      ORDER BY
        CASE mr.severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'advisory' THEN 4
        END,
        mr.created_at DESC
    ` as Array<{
      id: string;
      title: string;
      manufacturer: string;
      severity: string;
      matched_asset_count: number;
      created_at: string;
      unacknowledged_count: string;
    }>;

    return jsonResponse({
      success: true,
      data: rows.map((r) => ({
        ...r,
        unacknowledged_count: parseInt(r.unacknowledged_count, 10),
      })),
      requestId: ctx.requestId,
    });
  } catch (error) {
    logger.error('Failed to get recall alerts', { error });
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// GET RECALLS FOR A SPECIFIC ASSET (for AssetDetail banner)
// =============================================

export async function getAssetRecalls(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  const logger = Logger.fromContext(ctx);
  const assetId = params['assetId'];
  if (!assetId) throw new BadRequestError('Missing asset ID');

  try {
    const sql = neon(ctx.env.DATABASE_URL);

    const rows = await sql`
      SELECT
        ram.id AS match_id,
        ram.match_reason,
        ram.match_confidence,
        ram.status AS match_status,
        ram.acknowledged_at,
        ram.action_taken,
        ram.notes,
        mr.id AS recall_id,
        mr.title,
        mr.manufacturer,
        mr.severity,
        mr.description,
        mr.source_url,
        mr.source_reference,
        mr.published_date,
        mr.status AS recall_status
      FROM recall_asset_matches ram
      JOIN manufacturer_recalls mr ON mr.id = ram.recall_id
      WHERE ram.asset_id = ${assetId}
        AND ram.org_id = ${ctx.orgId}
        AND mr.status = 'active'
      ORDER BY
        CASE mr.severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'advisory' THEN 4
        END
    `;

    return jsonResponse({
      success: true,
      data: rows,
      requestId: ctx.requestId,
    });
  } catch (error) {
    logger.error('Failed to get asset recalls', { error, assetId });
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// RE-RUN MATCHING (manual trigger)
// =============================================

export async function rematchRecall(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireManagerOrAdmin(ctx);
  const logger = Logger.fromContext(ctx);
  const recallId = params['id'];
  if (!recallId) throw new BadRequestError('Missing recall ID');

  try {
    const sql = neon(ctx.env.DATABASE_URL);

    const recallRows = await sql`
      SELECT * FROM manufacturer_recalls WHERE id = ${recallId} AND org_id = ${ctx.orgId}
    ` as RecallRow[];
    const recall = recallRows[0];
    if (!recall) throw new NotFoundError('Recall not found');

    // Delete existing unacknowledged matches only (preserve actioned ones)
    await sql`
      DELETE FROM recall_asset_matches
      WHERE recall_id = ${recallId} AND status = 'unacknowledged'
    `;

    const assets = await sql`
      SELECT id, site_id, asset_code, asset_type, manufacturer, model, is_active
      FROM assets WHERE org_id = ${ctx.orgId}
    ` as AssetForMatching[];

    // Get already-actioned asset IDs to exclude
    const actionedRows = await sql`
      SELECT asset_id FROM recall_asset_matches WHERE recall_id = ${recallId}
    ` as Array<{ asset_id: string }>;
    const actionedAssetIds = new Set(actionedRows.map((r) => r.asset_id));

    const allMatches = matchRecallToAssets(recall.manufacturer, recall.affected_models, assets);
    const newMatches = allMatches.filter((m) => !actionedAssetIds.has(m.assetId));

    if (newMatches.length > 0) {
      const values = newMatches.map((m) =>
        `('${ctx.orgId}', '${recallId}', '${m.assetId}', '${m.siteId}', '${m.reason.replace(/'/g, "''")}', '${m.confidence}')`
      ).join(',\n');

      await sql(`
        INSERT INTO recall_asset_matches (org_id, recall_id, asset_id, site_id, match_reason, match_confidence)
        VALUES ${values}
        ON CONFLICT (recall_id, asset_id) DO NOTHING
      `);
    }

    const totalCount = allMatches.length;
    await sql`
      UPDATE manufacturer_recalls SET matched_asset_count = ${totalCount} WHERE id = ${recallId}
    `;

    logger.info('Recall rematched', { recallId, totalMatches: totalCount, newMatches: newMatches.length });

    return jsonResponse({
      success: true,
      data: { id: recallId, matched_asset_count: totalCount, new_matches: newMatches.length },
      requestId: ctx.requestId,
    });
  } catch (error) {
    logger.error('Failed to rematch recall', { error, recallId });
    return formatErrorResponse(error, ctx.requestId);
  }
}
