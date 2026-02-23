/**
 * InspectVoice — Assets Route Handler
 * CRUD endpoints for asset (equipment) management.
 *
 * Endpoints:
 *   GET    /api/v1/sites/:siteId/assets  — List assets for a site
 *   GET    /api/v1/assets/:id            — Get asset detail
 *   POST   /api/v1/assets                — Create asset (including on-site during inspection)
 *   PUT    /api/v1/assets/:id            — Update asset
 *
 * Assets belong to sites. Tenant isolation is enforced by verifying the
 * parent site belongs to the requesting org before any asset operation.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { writeAuditLog, buildChanges } from '../services/audit';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { NotFoundError } from '../shared/errors';
import {
  parseJsonBody,
  validateUUID,
  validateString,
  validateOptionalString,
  validateOptionalNumber,
  validateOptionalISODate,
  validateOptionalFallHeight,
  validateOptionalCostGbp,
  validateOptionalEnum,
  validateBoolean,
  validateOptionalBoolean,
} from '../shared/validation';
import {
  parsePagination,
  buildPaginationMeta,
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

const ASSET_CATEGORIES = [
  'playground', 'outdoor_gym', 'furniture', 'sports', 'other',
] as const;

const SURFACE_TYPES = [
  'wetpour', 'rubber_mulch', 'bark_mulch', 'grass', 'sand',
  'artificial_grass', 'tarmac', 'concrete', 'other',
] as const;

const ASSET_SORT_COLUMNS = ['asset_code', 'asset_type', 'created_at', 'last_inspection_date'] as const;

// =============================================
// LIST ASSETS FOR SITE
// =============================================

export async function listAssetsBySite(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const siteId = validateUUID(params['siteId'], 'siteId');
  const db = createDb(ctx);

  // Verify site belongs to this org
  await db.findByIdOrThrow('sites', siteId, 'Site');

  const pagination = parsePagination(request, ctx.env);
  const { limit, offset } = paginationToOffset(pagination);
  const sortBy = parseSortField(request, [...ASSET_SORT_COLUMNS], 'asset_code');
  const sortDir = parseSortDirection(request);
  const search = parseSearchQuery(request);
  const categoryFilter = parseFilterParam(request, 'category');
  const activeFilter = parseFilterParam(request, 'active');

  // Build WHERE conditions
  // Note: findByParent uses $1 for org_id and $2 for parent_id
  // So user conditions start at $3
  const conditions: string[] = [];
  const conditionParams: unknown[] = [];
  let paramIndex = 3;

  if (search) {
    conditions.push(`(c.asset_code ILIKE $${paramIndex} OR c.manufacturer ILIKE $${paramIndex} OR c.model ILIKE $${paramIndex})`);
    conditionParams.push(`%${search}%`);
    paramIndex++;
  }

  if (categoryFilter && ASSET_CATEGORIES.includes(categoryFilter as typeof ASSET_CATEGORIES[number])) {
    conditions.push(`c.asset_category = $${paramIndex}`);
    conditionParams.push(categoryFilter);
    paramIndex++;
  }

  if (activeFilter === 'true' || activeFilter === 'false') {
    conditions.push(`c.is_active = $${paramIndex}`);
    conditionParams.push(activeFilter === 'true');
    paramIndex++;
  }

  // Use raw query for flexibility with additional conditions
  const whereExtra = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*)::int AS count FROM assets c
    INNER JOIN sites p ON c.site_id = p.id
    WHERE p.org_id = $1 AND c.site_id = $2${whereExtra}`;

  const countResult = await db.rawQuery<{ count: number }>(
    countSql,
    [ctx.orgId, siteId, ...conditionParams],
  );
  const totalCount = countResult[0]?.count ?? 0;

  const dataSql = `SELECT c.* FROM assets c
    INNER JOIN sites p ON c.site_id = p.id
    WHERE p.org_id = $1 AND c.site_id = $2${whereExtra}
    ORDER BY c.${sortBy} ${sortDir === 'asc' ? 'ASC' : 'DESC'}
    LIMIT ${limit} OFFSET ${offset}`;

  const assets = await db.rawQuery(
    dataSql,
    [ctx.orgId, siteId, ...conditionParams],
  );

  return jsonResponse({
    success: true,
    data: assets,
    meta: buildPaginationMeta(pagination, totalCount),
  }, ctx.requestId);
}

// =============================================
// GET ASSET
// =============================================

export async function getAsset(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  // Asset doesn't have org_id directly — verify through site
  const rows = await db.rawQuery<Record<string, unknown>>(
    `SELECT a.* FROM assets a
     INNER JOIN sites s ON a.site_id = s.id
     WHERE s.org_id = $1 AND a.id = $2
     LIMIT 1`,
    [ctx.orgId, id],
  );

  if (!rows[0]) {
    throw new NotFoundError('Asset not found');
  }

  return jsonResponse({
    success: true,
    data: rows[0],
  }, ctx.requestId);
}

// =============================================
// CREATE ASSET
// =============================================

export async function createAsset(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // Validate site_id and verify ownership
  const siteId = validateUUID(body['site_id'], 'site_id');
  await db.findByIdOrThrow('sites', siteId, 'Site');

  // Validate fields
  const data: Record<string, unknown> = {
    id: typeof body['id'] === 'string' && body['id'].length > 0
      ? validateUUID(body['id'], 'id')
      : crypto.randomUUID(),
    site_id: siteId,
    asset_code: validateString(body['asset_code'], 'asset_code', { maxLength: 50 }),
    asset_type: validateString(body['asset_type'], 'asset_type', { maxLength: 50 }),
    asset_category: validateOptionalEnum(body['asset_category'], 'asset_category', ASSET_CATEGORIES) ?? 'playground',
    manufacturer: validateOptionalString(body['manufacturer'], 'manufacturer', { maxLength: 200 }),
    model: validateOptionalString(body['model'], 'model', { maxLength: 200 }),
    serial_number: validateOptionalString(body['serial_number'], 'serial_number', { maxLength: 100 }),
    install_date: validateOptionalISODate(body['install_date'], 'install_date'),
    purchase_cost_gbp: validateOptionalCostGbp(body['purchase_cost_gbp'], 'purchase_cost_gbp'),
    compliance_standard: validateOptionalString(body['compliance_standard'], 'compliance_standard', { maxLength: 500 }),
    expected_lifespan_years: validateOptionalNumber(body['expected_lifespan_years'], 'expected_lifespan_years', { min: 1, max: 100, integer: true }),
    surface_type: validateOptionalEnum(body['surface_type'], 'surface_type', SURFACE_TYPES),
    fall_height_mm: validateOptionalFallHeight(body['fall_height_mm'], 'fall_height_mm'),
    impact_attenuation_required_mm: validateOptionalFallHeight(body['impact_attenuation_required_mm'], 'impact_attenuation_required_mm'),
    last_maintenance_date: validateOptionalISODate(body['last_maintenance_date'], 'last_maintenance_date'),
    next_maintenance_due: validateOptionalISODate(body['next_maintenance_due'], 'next_maintenance_due'),
    maintenance_notes: validateOptionalString(body['maintenance_notes'], 'maintenance_notes', { maxLength: 5000 }),
    reference_photo_id: null,
    is_active: validateOptionalBoolean(body['is_active'], 'is_active', true),
    decommissioned_date: null,
    decommission_reason: null,
    metadata: body['metadata'] ?? {},
  };

  // Insert — db.insert auto-adds org_id, but assets table uses site_id for org linkage.
  // We need to use rawQuery since assets doesn't have org_id column directly.
  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const now = new Date().toISOString();

  const insertSql = `INSERT INTO assets (${columns.join(', ')}, created_at, updated_at)
    VALUES (${placeholders.join(', ')}, $${values.length + 1}, $${values.length + 2})
    RETURNING *`;

  const rows = await db.rawQuery<Record<string, unknown>>(
    insertSql,
    [...values, now, now],
  );

  const asset = rows[0];

  void writeAuditLog(ctx, 'asset.created', 'assets', data['id'] as string, {
    asset_code: data['asset_code'],
    asset_type: data['asset_type'],
    site_id: siteId,
  }, request);

  return jsonResponse({
    success: true,
    data: asset,
  }, ctx.requestId, 201);
}

// =============================================
// UPDATE ASSET
// =============================================

export async function updateAsset(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const id = validateUUID(params['id'], 'id');
  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // Verify asset exists and belongs to this org (via site)
  const existingRows = await db.rawQuery<Record<string, unknown>>(
    `SELECT a.* FROM assets a
     INNER JOIN sites s ON a.site_id = s.id
     WHERE s.org_id = $1 AND a.id = $2
     LIMIT 1`,
    [ctx.orgId, id],
  );

  if (!existingRows[0]) {
    throw new NotFoundError('Asset not found');
  }

  const existing = existingRows[0];

  // Build update data from provided fields
  const data: Record<string, unknown> = {};

  if ('asset_code' in body) data['asset_code'] = validateString(body['asset_code'], 'asset_code', { maxLength: 50 });
  if ('asset_type' in body) data['asset_type'] = validateString(body['asset_type'], 'asset_type', { maxLength: 50 });
  if ('asset_category' in body) data['asset_category'] = validateOptionalEnum(body['asset_category'], 'asset_category', ASSET_CATEGORIES);
  if ('manufacturer' in body) data['manufacturer'] = validateOptionalString(body['manufacturer'], 'manufacturer', { maxLength: 200 });
  if ('model' in body) data['model'] = validateOptionalString(body['model'], 'model', { maxLength: 200 });
  if ('serial_number' in body) data['serial_number'] = validateOptionalString(body['serial_number'], 'serial_number', { maxLength: 100 });
  if ('install_date' in body) data['install_date'] = validateOptionalISODate(body['install_date'], 'install_date');
  if ('purchase_cost_gbp' in body) data['purchase_cost_gbp'] = validateOptionalCostGbp(body['purchase_cost_gbp'], 'purchase_cost_gbp');
  if ('compliance_standard' in body) data['compliance_standard'] = validateOptionalString(body['compliance_standard'], 'compliance_standard', { maxLength: 500 });
  if ('expected_lifespan_years' in body) data['expected_lifespan_years'] = validateOptionalNumber(body['expected_lifespan_years'], 'expected_lifespan_years', { min: 1, max: 100, integer: true });
  if ('surface_type' in body) data['surface_type'] = validateOptionalEnum(body['surface_type'], 'surface_type', SURFACE_TYPES);
  if ('fall_height_mm' in body) data['fall_height_mm'] = validateOptionalFallHeight(body['fall_height_mm'], 'fall_height_mm');
  if ('impact_attenuation_required_mm' in body) data['impact_attenuation_required_mm'] = validateOptionalFallHeight(body['impact_attenuation_required_mm'], 'impact_attenuation_required_mm');
  if ('last_maintenance_date' in body) data['last_maintenance_date'] = validateOptionalISODate(body['last_maintenance_date'], 'last_maintenance_date');
  if ('next_maintenance_due' in body) data['next_maintenance_due'] = validateOptionalISODate(body['next_maintenance_due'], 'next_maintenance_due');
  if ('maintenance_notes' in body) data['maintenance_notes'] = validateOptionalString(body['maintenance_notes'], 'maintenance_notes', { maxLength: 5000 });
  if ('is_active' in body) data['is_active'] = validateBoolean(body['is_active'], 'is_active');
  if ('decommissioned_date' in body) data['decommissioned_date'] = validateOptionalISODate(body['decommissioned_date'], 'decommissioned_date');
  if ('decommission_reason' in body) data['decommission_reason'] = validateOptionalString(body['decommission_reason'], 'decommission_reason', { maxLength: 1000 });
  if ('metadata' in body) data['metadata'] = body['metadata'];

  if (Object.keys(data).length === 0) {
    return jsonResponse({ success: true, data: existing }, ctx.requestId);
  }

  // Build UPDATE query manually (assets doesn't have org_id column)
  data['updated_at'] = new Date().toISOString();
  const setClauses = Object.keys(data).map((col, i) => `${col} = $${i + 1}`);
  const updateSql = `UPDATE assets SET ${setClauses.join(', ')}
    WHERE id = $${Object.keys(data).length + 1}
    AND site_id IN (SELECT id FROM sites WHERE org_id = $${Object.keys(data).length + 2})
    RETURNING *`;

  const updatedRows = await db.rawQuery<Record<string, unknown>>(
    updateSql,
    [...Object.values(data), id, ctx.orgId],
  );

  const changes = buildChanges(existing, data);
  if (Object.keys(changes).length > 0) {
    void writeAuditLog(ctx, 'asset.updated', 'assets', id, changes, request);
  }

  return jsonResponse({
    success: true,
    data: updatedRows[0] ?? existing,
  }, ctx.requestId);
}
