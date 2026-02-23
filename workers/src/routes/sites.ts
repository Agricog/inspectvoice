/**
 * InspectVoice — Sites Route Handler
 * CRUD endpoints for site management.
 *
 * Endpoints:
 *   GET    /api/v1/sites           — List sites (paginated, searchable, filterable)
 *   GET    /api/v1/sites/:id       — Get site detail
 *   POST   /api/v1/sites           — Create site
 *   PUT    /api/v1/sites/:id       — Update site
 *
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
  validateOptionalPostcode,
  validateOptionalPhone,
  validateOptionalEmail,
  validateLatitude,
  validateLongitude,
  validateEnum,
  validateOptionalEnum,
  validateFrequencyDays,
  validateOptionalNumber,
  validateOptionalCostGbp,
  validateOptionalISODate,
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
import { jsonResponse, noContentResponse } from './helpers';

// =============================================
// ALLOWED VALUES
// =============================================

const SITE_TYPES = [
  'playground', 'park', 'outdoor_gym', 'muga',
  'skate_park', 'sports_pitch', 'mixed',
] as const;

const SITE_STATUSES = ['active', 'archived', 'temporary_closure'] as const;

const SITE_SORT_COLUMNS = ['name', 'created_at', 'updated_at', 'status'] as const;

// =============================================
// LIST SITES
// =============================================

export async function listSites(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const db = createDb(ctx);
  const pagination = parsePagination(request, ctx.env);
  const { limit, offset } = paginationToOffset(pagination);
  const sortBy = parseSortField(request, [...SITE_SORT_COLUMNS], 'name');
  const sortDir = parseSortDirection(request);
  const search = parseSearchQuery(request);
  const statusFilter = parseFilterParam(request, 'status');
  const typeFilter = parseFilterParam(request, 'type');

  // Build WHERE conditions
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 2; // $1 is org_id (injected by db.findMany)

  if (search) {
    conditions.push(`(name ILIKE $${paramIndex} OR address ILIKE $${paramIndex} OR postcode ILIKE $${paramIndex})`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (statusFilter && SITE_STATUSES.includes(statusFilter as typeof SITE_STATUSES[number])) {
    conditions.push(`status = $${paramIndex}`);
    params.push(statusFilter);
    paramIndex++;
  }

  if (typeFilter && SITE_TYPES.includes(typeFilter as typeof SITE_TYPES[number])) {
    conditions.push(`site_type = $${paramIndex}`);
    params.push(typeFilter);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '';

  // Get total count for pagination meta
  const totalCount = await db.count('sites', whereClause, params);

  // Get paginated results
  const sites = await db.findMany(
    'sites',
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
    data: sites,
    meta: buildPaginationMeta(pagination, totalCount),
  }, ctx.requestId);
}

// =============================================
// GET SITE
// =============================================

export async function getSite(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  const site = await db.findByIdOrThrow('sites', id, 'Site');

  return jsonResponse({
    success: true,
    data: site,
  }, ctx.requestId);
}

// =============================================
// CREATE SITE
// =============================================

export async function createSite(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // Validate all fields
  const data = {
    id: crypto.randomUUID(),
    name: validateString(body['name'], 'name', { maxLength: 200 }),
    site_code: validateOptionalString(body['site_code'], 'site_code', { maxLength: 50 }),
    address: validateString(body['address'], 'address', { maxLength: 500 }),
    postcode: validateOptionalPostcode(body['postcode'], 'postcode'),
    latitude: validateLatitude(body['latitude'], 'latitude'),
    longitude: validateLongitude(body['longitude'], 'longitude'),
    site_type: validateEnum(body['site_type'], 'site_type', SITE_TYPES),
    contact_name: validateOptionalString(body['contact_name'], 'contact_name', { maxLength: 200 }),
    contact_phone: validateOptionalPhone(body['contact_phone'], 'contact_phone'),
    contact_email: validateOptionalEmail(body['contact_email'], 'contact_email'),
    access_notes: validateOptionalString(body['access_notes'], 'access_notes', { maxLength: 2000 }),
    opening_hours: body['opening_hours'] ?? null,
    parking_notes: validateOptionalString(body['parking_notes'], 'parking_notes', { maxLength: 1000 }),
    install_date: validateOptionalISODate(body['install_date'], 'install_date'),
    last_refurbishment_date: validateOptionalISODate(body['last_refurbishment_date'], 'last_refurbishment_date'),
    inspection_frequency_routine_days: validateFrequencyDays(body['inspection_frequency_routine_days'] ?? 7, 'inspection_frequency_routine_days'),
    inspection_frequency_operational_days: validateFrequencyDays(body['inspection_frequency_operational_days'] ?? 90, 'inspection_frequency_operational_days'),
    inspection_frequency_annual_days: validateFrequencyDays(body['inspection_frequency_annual_days'] ?? 365, 'inspection_frequency_annual_days'),
    total_asset_value_gbp: validateOptionalCostGbp(body['total_asset_value_gbp'], 'total_asset_value_gbp'),
    maintenance_contract_ref: validateOptionalString(body['maintenance_contract_ref'], 'maintenance_contract_ref', { maxLength: 100 }),
    status: validateOptionalEnum(body['status'], 'status', SITE_STATUSES) ?? 'active',
    closure_reason: validateOptionalString(body['closure_reason'], 'closure_reason', { maxLength: 1000 }),
    notes: validateOptionalString(body['notes'], 'notes', { maxLength: 5000 }),
    metadata: body['metadata'] ?? {},
    created_by: ctx.userId,
  };

  const site = await db.insert('sites', data);

  // Audit
  void writeAuditLog(ctx, 'site.created', 'sites', data.id, { name: data.name }, request);

  return jsonResponse({
    success: true,
    data: site,
  }, ctx.requestId, 201);
}

// =============================================
// UPDATE SITE
// =============================================

export async function updateSite(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const id = validateUUID(params['id'], 'id');
  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // Verify site exists and belongs to this org
  const existing = await db.findByIdOrThrow<Record<string, unknown>>('sites', id, 'Site');

  // Validate only the fields that are present in the update
  const data: Record<string, unknown> = {};

  if ('name' in body) data['name'] = validateString(body['name'], 'name', { maxLength: 200 });
  if ('site_code' in body) data['site_code'] = validateOptionalString(body['site_code'], 'site_code', { maxLength: 50 });
  if ('address' in body) data['address'] = validateString(body['address'], 'address', { maxLength: 500 });
  if ('postcode' in body) data['postcode'] = validateOptionalPostcode(body['postcode'], 'postcode');
  if ('latitude' in body) data['latitude'] = validateLatitude(body['latitude'], 'latitude');
  if ('longitude' in body) data['longitude'] = validateLongitude(body['longitude'], 'longitude');
  if ('site_type' in body) data['site_type'] = validateEnum(body['site_type'], 'site_type', SITE_TYPES);
  if ('contact_name' in body) data['contact_name'] = validateOptionalString(body['contact_name'], 'contact_name', { maxLength: 200 });
  if ('contact_phone' in body) data['contact_phone'] = validateOptionalPhone(body['contact_phone'], 'contact_phone');
  if ('contact_email' in body) data['contact_email'] = validateOptionalEmail(body['contact_email'], 'contact_email');
  if ('access_notes' in body) data['access_notes'] = validateOptionalString(body['access_notes'], 'access_notes', { maxLength: 2000 });
  if ('opening_hours' in body) data['opening_hours'] = body['opening_hours'];
  if ('parking_notes' in body) data['parking_notes'] = validateOptionalString(body['parking_notes'], 'parking_notes', { maxLength: 1000 });
  if ('install_date' in body) data['install_date'] = validateOptionalISODate(body['install_date'], 'install_date');
  if ('last_refurbishment_date' in body) data['last_refurbishment_date'] = validateOptionalISODate(body['last_refurbishment_date'], 'last_refurbishment_date');
  if ('inspection_frequency_routine_days' in body) data['inspection_frequency_routine_days'] = validateFrequencyDays(body['inspection_frequency_routine_days'], 'inspection_frequency_routine_days');
  if ('inspection_frequency_operational_days' in body) data['inspection_frequency_operational_days'] = validateFrequencyDays(body['inspection_frequency_operational_days'], 'inspection_frequency_operational_days');
  if ('inspection_frequency_annual_days' in body) data['inspection_frequency_annual_days'] = validateFrequencyDays(body['inspection_frequency_annual_days'], 'inspection_frequency_annual_days');
  if ('total_asset_value_gbp' in body) data['total_asset_value_gbp'] = validateOptionalCostGbp(body['total_asset_value_gbp'], 'total_asset_value_gbp');
  if ('maintenance_contract_ref' in body) data['maintenance_contract_ref'] = validateOptionalString(body['maintenance_contract_ref'], 'maintenance_contract_ref', { maxLength: 100 });
  if ('status' in body) data['status'] = validateEnum(body['status'], 'status', SITE_STATUSES);
  if ('closure_reason' in body) data['closure_reason'] = validateOptionalString(body['closure_reason'], 'closure_reason', { maxLength: 1000 });
  if ('notes' in body) data['notes'] = validateOptionalString(body['notes'], 'notes', { maxLength: 5000 });
  if ('metadata' in body) data['metadata'] = body['metadata'];

  if (Object.keys(data).length === 0) {
    return noContentResponse(ctx.requestId);
  }

  const updated = await db.updateById('sites', id, data);

  // Audit with change tracking
  const changes = buildChanges(existing, data);
  if (Object.keys(changes).length > 0) {
    void writeAuditLog(ctx, 'site.updated', 'sites', id, changes, request);
  }

  return jsonResponse({
    success: true,
    data: updated,
  }, ctx.requestId);
}
