/**
 * InspectVoice — Defect Library Route Handlers
 * Feature 15: CRUD, quick-pick, version history, seed, audit
 *
 * Routes:
 *   GET    /api/v1/defect-library                     → list entries (filtered)
 *   GET    /api/v1/defect-library/quick-pick/:assetType → top entries for capture bottom-sheet
 *   GET    /api/v1/defect-library/:id                 → single entry with current version
 *   GET    /api/v1/defect-library/:id/versions        → version history
 *   POST   /api/v1/defect-library                     → create org entry (manager/admin)
 *   PUT    /api/v1/defect-library/:id                 → update org entry → new version (manager/admin)
 *   DELETE /api/v1/defect-library/:id                 → soft-delete org entry (manager/admin)
 *   POST   /api/v1/defect-library/seed                → seed system entries (admin only, idempotent)
 *   POST   /api/v1/defect-library/:id/record-usage    → bump usage counter on pick
 *
 * RBAC:
 *   - All org members: read + quick-pick + record-usage
 *   - org:admin + org:manager: create, update, delete org entries
 *   - System entries: read-only in-app
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import type { RequestContext, RouteParams } from '../types';
import { formatErrorResponse } from '../shared/errors';
import { Logger } from '../shared/logger';
import { DEFECT_LIBRARY_SEED } from '../data/defectLibrarySeed';

// =============================================
// HELPERS
// =============================================

function json<T>(data: T, requestId: string, status = 200): Response {
  return new Response(
    JSON.stringify({ success: true, data, requestId }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function paginated<T>(data: T, total: number, limit: number, offset: number, requestId: string): Response {
  return new Response(
    JSON.stringify({ success: true, data, pagination: { total, limit, offset }, requestId }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
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

// =============================================
// SQL BUILDER — Neon serverless via DATABASE_URL
// =============================================

async function query(ctx: RequestContext, sql: string, params: unknown[] = []): Promise<unknown[]> {
  const { neon } = await import('@neondatabase/serverless');
  const sql_fn = neon(ctx.env.DATABASE_URL);
  return sql_fn(sql, params) as Promise<unknown[]>;
}

// =============================================
// LIST ENTRIES (filtered)
// GET /api/v1/defect-library
// =============================================

export async function listDefectLibrary(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const assetType = url.searchParams.get('asset_type');
    const source = url.searchParams.get('source');
    const search = url.searchParams.get('search');
    const isActive = url.searchParams.get('is_active');
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    // Always scope: system entries + this org's entries
    conditions.push(`(e.source = 'system' OR e.org_id = $${paramIdx})`);
    values.push(ctx.orgId);
    paramIdx++;

    if (assetType) {
      conditions.push(`(e.asset_type = $${paramIdx} OR e.asset_type = 'all')`);
      values.push(assetType);
      paramIdx++;
    }

    if (source === 'system' || source === 'org') {
      conditions.push(`e.source = $${paramIdx}`);
      values.push(source);
      paramIdx++;
    }

    if (isActive === 'true' || isActive === 'false') {
      conditions.push(`e.is_active = $${paramIdx}`);
      values.push(isActive === 'true');
      paramIdx++;
    } else {
      conditions.push('e.is_active = true');
    }

    if (search) {
      conditions.push(`(e.title ILIKE $${paramIdx} OR v.description_template ILIKE $${paramIdx})`);
      values.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const countSql = `
      SELECT COUNT(DISTINCT e.id)::int AS total
      FROM defect_library_entry e
      LEFT JOIN LATERAL (
        SELECT * FROM defect_library_entry_version
        WHERE entry_id = e.id ORDER BY version DESC LIMIT 1
      ) v ON true
      ${whereClause}
    `;
    const countResult = await query(ctx, countSql, values) as Array<{ total: number }>;
    const total = countResult[0]?.total ?? 0;

    // Data with latest version joined
    const dataSql = `
      SELECT
        e.id, e.org_id, e.source, e.asset_type, e.title, e.system_key,
        e.is_active, e.sort_order, e.usage_count, e.created_at, e.created_by_user_id,
        v.id AS version_id, v.version, v.description_template, v.bs_en_refs,
        v.severity_default, v.remedial_action_template, v.cost_band,
        v.timeframe_default, v.created_at AS version_created_at,
        v.created_by_user_id AS version_created_by, v.change_note
      FROM defect_library_entry e
      LEFT JOIN LATERAL (
        SELECT * FROM defect_library_entry_version
        WHERE entry_id = e.id ORDER BY version DESC LIMIT 1
      ) v ON true
      ${whereClause}
      ORDER BY e.sort_order ASC, e.usage_count DESC, e.title ASC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    values.push(limit, offset);

    const rows = await query(ctx, dataSql, values) as Array<Record<string, unknown>>;
    const entries = rows.map(mapRowToEntry);

    return paginated(entries, total, limit, offset, ctx.requestId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// QUICK-PICK (capture bottom-sheet)
// GET /api/v1/defect-library/quick-pick/:assetType
// =============================================

export async function quickPickDefects(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    const assetType = params['assetType'] ?? '';
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '8', 10), 20);

    const sql = `
      SELECT
        e.id AS entry_id, v.id AS version_id, e.title,
        v.description_template, v.bs_en_refs, v.severity_default,
        v.remedial_action_template, v.cost_band, v.timeframe_default,
        e.source, e.usage_count
      FROM defect_library_entry e
      INNER JOIN LATERAL (
        SELECT * FROM defect_library_entry_version
        WHERE entry_id = e.id ORDER BY version DESC LIMIT 1
      ) v ON true
      WHERE e.is_active = true
        AND (e.asset_type = $1 OR e.asset_type = 'all')
        AND (e.source = 'system' OR e.org_id = $2)
      ORDER BY e.usage_count DESC, e.sort_order ASC
      LIMIT $3
    `;

    const rows = await query(ctx, sql, [assetType, ctx.orgId, limit]) as Array<Record<string, unknown>>;

    const items = rows.map((r) => ({
      entry_id: r['entry_id'] as string,
      version_id: r['version_id'] as string,
      title: r['title'] as string,
      description_template: r['description_template'] as string,
      bs_en_refs: r['bs_en_refs'] as string[],
      severity_default: r['severity_default'] as string,
      remedial_action_template: r['remedial_action_template'] as string,
      cost_band: r['cost_band'] as string | null,
      timeframe_default: r['timeframe_default'] as string | null,
      source: r['source'] as string,
      usage_count: r['usage_count'] as number,
    }));

    return json(items, ctx.requestId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// GET SINGLE ENTRY
// GET /api/v1/defect-library/:id
// =============================================

export async function getDefectLibraryEntry(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    const entryId = params['id'] ?? '';

    const sql = `
      SELECT
        e.id, e.org_id, e.source, e.asset_type, e.title, e.system_key,
        e.is_active, e.sort_order, e.usage_count, e.created_at, e.created_by_user_id,
        v.id AS version_id, v.version, v.description_template, v.bs_en_refs,
        v.severity_default, v.remedial_action_template, v.cost_band,
        v.timeframe_default, v.created_at AS version_created_at,
        v.created_by_user_id AS version_created_by, v.change_note
      FROM defect_library_entry e
      LEFT JOIN LATERAL (
        SELECT * FROM defect_library_entry_version
        WHERE entry_id = e.id ORDER BY version DESC LIMIT 1
      ) v ON true
      WHERE e.id = $1
        AND (e.source = 'system' OR e.org_id = $2)
    `;

    const rows = await query(ctx, sql, [entryId, ctx.orgId]) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Library entry not found', requestId: ctx.requestId } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return json(mapRowToEntry(rows[0]!), ctx.requestId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// VERSION HISTORY
// GET /api/v1/defect-library/:id/versions
// =============================================

export async function getDefectLibraryVersions(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    if (!isManagerOrAdmin(ctx.userRole)) return forbidden(ctx.requestId);

    const entryId = params['id'] ?? '';

    const sql = `
      SELECT id, entry_id, version, description_template, bs_en_refs,
             severity_default, remedial_action_template, cost_band,
             timeframe_default, created_at, created_by_user_id, change_note
      FROM defect_library_entry_version
      WHERE entry_id = $1
      ORDER BY version DESC
    `;

    const rows = await query(ctx, sql, [entryId]) as Array<Record<string, unknown>>;

    const versions = rows.map((r) => ({
      id: r['id'] as string,
      entry_id: r['entry_id'] as string,
      version: r['version'] as number,
      description_template: r['description_template'] as string,
      bs_en_refs: r['bs_en_refs'] as string[],
      severity_default: r['severity_default'] as string,
      remedial_action_template: r['remedial_action_template'] as string,
      cost_band: r['cost_band'] as string | null,
      timeframe_default: r['timeframe_default'] as string | null,
      created_at: r['created_at'] as string,
      created_by_user_id: r['created_by_user_id'] as string | null,
      change_note: r['change_note'] as string | null,
    }));

    return json(versions, ctx.requestId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// CREATE ORG ENTRY
// POST /api/v1/defect-library
// =============================================

export async function createDefectLibraryEntry(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    if (!isManagerOrAdmin(ctx.userRole)) return forbidden(ctx.requestId);

    const body = await request.json() as Record<string, unknown>;
    const assetType = body['asset_type'] as string;
    const title = body['title'] as string;
    const systemKey = (body['system_key'] as string | undefined) ?? null;
    const descriptionTemplate = body['description_template'] as string;
    const bsEnRefs = (body['bs_en_refs'] as string[]) ?? [];
    const severityDefault = body['severity_default'] as string;
    const remedialActionTemplate = body['remedial_action_template'] as string;
    const costBand = (body['cost_band'] as string | undefined) ?? null;
    const timeframeDefault = (body['timeframe_default'] as string | undefined) ?? null;
    const changeNote = (body['change_note'] as string | undefined) ?? 'Initial version';

    if (!assetType || !title || !descriptionTemplate || !severityDefault || !remedialActionTemplate) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing required fields: asset_type, title, description_template, severity_default, remedial_action_template', requestId: ctx.requestId } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Create entry
    const entrySql = `
      INSERT INTO defect_library_entry (org_id, source, asset_type, title, system_key, created_by_user_id)
      VALUES ($1, 'org', $2, $3, $4, $5)
      RETURNING id, created_at
    `;
    const entryRows = await query(ctx, entrySql, [ctx.orgId, assetType, title, systemKey, ctx.userId]) as Array<Record<string, unknown>>;
    const entryRow = entryRows[0]!;
    const entryId = entryRow['id'] as string;

    // Create version 1
    const versionSql = `
      INSERT INTO defect_library_entry_version
        (entry_id, version, description_template, bs_en_refs, severity_default,
         remedial_action_template, cost_band, timeframe_default, created_by_user_id, change_note)
      VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `;
    const versionRows = await query(ctx, versionSql, [
      entryId, descriptionTemplate, bsEnRefs, severityDefault,
      remedialActionTemplate, costBand, timeframeDefault, ctx.userId, changeNote,
    ]) as Array<Record<string, unknown>>;

    const logger = Logger.fromContext(ctx);
    logger.info('Defect library entry created', { entryId, assetType, title });

    return json({
      id: entryId,
      version_id: versionRows[0]!['id'] as string,
      created_at: entryRow['created_at'],
    }, ctx.requestId, 201);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// UPDATE ORG ENTRY (creates new version)
// PUT /api/v1/defect-library/:id
// =============================================

export async function updateDefectLibraryEntry(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    if (!isManagerOrAdmin(ctx.userRole)) return forbidden(ctx.requestId);

    const entryId = params['id'] ?? '';

    // Verify entry exists and belongs to this org (system entries are read-only)
    const checkSql = `SELECT id, source, org_id FROM defect_library_entry WHERE id = $1`;
    const checkRows = await query(ctx, checkSql, [entryId]) as Array<Record<string, unknown>>;

    if (checkRows.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Library entry not found', requestId: ctx.requestId } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const existing = checkRows[0]!;
    if (existing['source'] === 'system') {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'System entries are read-only. Create an org override instead.', requestId: ctx.requestId } }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (existing['org_id'] !== ctx.orgId) {
      return forbidden(ctx.requestId);
    }

    const body = await request.json() as Record<string, unknown>;

    // Get current max version
    const maxVersionSql = `SELECT COALESCE(MAX(version), 0)::int AS max_v FROM defect_library_entry_version WHERE entry_id = $1`;
    const maxRows = await query(ctx, maxVersionSql, [entryId]) as Array<{ max_v: number }>;
    const nextVersion = (maxRows[0]?.max_v ?? 0) + 1;

    // Update entry title if provided
    if (body['title']) {
      await query(ctx, `UPDATE defect_library_entry SET title = $1 WHERE id = $2`, [body['title'], entryId]);
    }

    // Create new version
    const versionSql = `
      INSERT INTO defect_library_entry_version
        (entry_id, version, description_template, bs_en_refs, severity_default,
         remedial_action_template, cost_band, timeframe_default, created_by_user_id, change_note)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, created_at
    `;
    const versionRows = await query(ctx, versionSql, [
      entryId,
      nextVersion,
      body['description_template'] as string,
      (body['bs_en_refs'] as string[]) ?? [],
      body['severity_default'] as string,
      body['remedial_action_template'] as string,
      (body['cost_band'] as string | undefined) ?? null,
      (body['timeframe_default'] as string | undefined) ?? null,
      ctx.userId,
      (body['change_note'] as string | undefined) ?? null,
    ]) as Array<Record<string, unknown>>;

    // Record audit for protected field edits
    const protectedEdits = (body['protected_field_edits'] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const edit of protectedEdits) {
      await query(ctx, `
        INSERT INTO defect_field_audit (org_id, entity_type, entity_id, field_name, old_value, new_value, reason, changed_by_user_id)
        VALUES ($1, 'library_entry', $2, $3, $4, $5, $6, $7)
      `, [
        ctx.orgId, entryId, edit['field_name'], edit['old_value'], edit['new_value'], edit['reason'], ctx.userId,
      ]);
    }

    const logger = Logger.fromContext(ctx);
    logger.info('Defect library entry updated', { entryId, version: nextVersion });

    return json({
      id: entryId,
      version: nextVersion,
      version_id: versionRows[0]!['id'] as string,
      created_at: versionRows[0]!['created_at'],
    }, ctx.requestId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// SOFT DELETE ORG ENTRY
// DELETE /api/v1/defect-library/:id
// =============================================

export async function deleteDefectLibraryEntry(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    if (!isManagerOrAdmin(ctx.userRole)) return forbidden(ctx.requestId);

    const entryId = params['id'] ?? '';

    const result = await query(ctx, `
      UPDATE defect_library_entry
      SET is_active = false
      WHERE id = $1 AND org_id = $2 AND source = 'org'
      RETURNING id
    `, [entryId, ctx.orgId]) as Array<Record<string, unknown>>;

    if (result.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Org entry not found or already inactive', requestId: ctx.requestId } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return json({ id: entryId, deactivated: true }, ctx.requestId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// RECORD USAGE (bump counter on pick)
// POST /api/v1/defect-library/:id/record-usage
// =============================================

export async function recordLibraryUsage(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    const entryId = params['id'] ?? '';
    await query(ctx, `UPDATE defect_library_entry SET usage_count = usage_count + 1 WHERE id = $1`, [entryId]);
    return json({ success: true }, ctx.requestId);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// SEED SYSTEM ENTRIES (idempotent)
// POST /api/v1/defect-library/seed
// =============================================

export async function seedDefectLibrary(
  _request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  try {
    // Admin only
    if (ctx.userRole !== 'admin' && ctx.userRole !== 'org:admin') {
      return forbidden(ctx.requestId);
    }

    let created = 0;
    let skipped = 0;

    for (const seed of DEFECT_LIBRARY_SEED) {
      // Check if system_key already exists
      const existsRows = await query(ctx, `
        SELECT id FROM defect_library_entry WHERE system_key = $1 AND source = 'system'
      `, [seed.system_key]) as Array<Record<string, unknown>>;

      if (existsRows.length > 0) {
        skipped++;
        continue;
      }

      // Create entry
      const entryRows = await query(ctx, `
        INSERT INTO defect_library_entry (source, asset_type, title, system_key, sort_order)
        VALUES ('system', $1, $2, $3, $4)
        RETURNING id
      `, [seed.asset_type, seed.title, seed.system_key, seed.sort_order]) as Array<Record<string, unknown>>;

      const entryId = entryRows[0]!['id'] as string;

      // Create version 1
      await query(ctx, `
        INSERT INTO defect_library_entry_version
          (entry_id, version, description_template, bs_en_refs, severity_default,
           remedial_action_template, cost_band, timeframe_default, change_note)
        VALUES ($1, 1, $2, $3, $4, $5, $6, $7, 'System seed v1')
      `, [
        entryId, seed.description_template, seed.bs_en_refs,
        seed.severity_default, seed.remedial_action_template,
        seed.cost_band, seed.timeframe_default,
      ]);

      created++;
    }

    const logger = Logger.fromContext(ctx);
    logger.info('Defect library seeded', { created, skipped, total: DEFECT_LIBRARY_SEED.length });

    return json({ created, skipped, total: DEFECT_LIBRARY_SEED.length }, ctx.requestId, 201);
  } catch (error) {
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// ROW MAPPER
// =============================================

function mapRowToEntry(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r['id'],
    org_id: r['org_id'],
    source: r['source'],
    asset_type: r['asset_type'],
    title: r['title'],
    system_key: r['system_key'],
    is_active: r['is_active'],
    sort_order: r['sort_order'],
    usage_count: r['usage_count'],
    created_at: r['created_at'],
    created_by_user_id: r['created_by_user_id'],
    current_version: r['version_id']
      ? {
          id: r['version_id'],
          entry_id: r['id'],
          version: r['version'],
          description_template: r['description_template'],
          bs_en_refs: r['bs_en_refs'],
          severity_default: r['severity_default'],
          remedial_action_template: r['remedial_action_template'],
          cost_band: r['cost_band'],
          timeframe_default: r['timeframe_default'],
          created_at: r['version_created_at'],
          created_by_user_id: r['version_created_by'],
          change_note: r['change_note'],
        }
      : null,
  };
}
