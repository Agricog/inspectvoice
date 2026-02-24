/**
 * InspectVoice — Incidents Route Handler
 * CRUD endpoints for incident and complaint management.
 *
 * Endpoints:
 *   GET    /api/v1/incidents              — List incidents (filterable)
 *   GET    /api/v1/incidents/:id          — Get incident detail
 *   POST   /api/v1/incidents              — Create incident
 *   PUT    /api/v1/incidents/:id          — Update incident
 *
 * Incidents link to sites, optionally to assets and defects.
 * Tenant isolation via org_id on the incidents table directly.
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

const INCIDENT_TYPES = [
  'injury', 'complaint', 'near_miss', 'vandalism', 'property_damage', 'other',
] as const;

const SEVERITY_LEVELS = [
  'minor', 'moderate', 'serious', 'major',
] as const;

const INCIDENT_STATUSES = [
  'open', 'investigating', 'closed', 'claim_received', 'claim_settled',
] as const;

const SORT_COLUMNS = [
  'incident_date', 'created_at', 'severity', 'status',
] as const;

// =============================================
// LIST INCIDENTS
// =============================================

export async function listIncidents(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const db = createDb(ctx);

  const pagination = parsePagination(request, ctx.env);
  const { limit, offset } = paginationToOffset(pagination);
  const sortBy = parseSortField(request, [...SORT_COLUMNS], 'incident_date');
  const sortDir = parseSortDirection(request);
  const search = parseSearchQuery(request);
  const typeFilter = parseFilterParam(request, 'type');
  const statusFilter = parseFilterParam(request, 'status');
  const severityFilter = parseFilterParam(request, 'severity');
  const siteFilter = parseFilterParam(request, 'site_id');

  const conditions: string[] = [];
  const conditionParams: unknown[] = [];
  let paramIndex = 2; // $1 = org_id

  if (search) {
    conditions.push(`(i.description ILIKE $${paramIndex} OR i.reported_by ILIKE $${paramIndex} OR i.injured_party_name ILIKE $${paramIndex})`);
    conditionParams.push(`%${search}%`);
    paramIndex++;
  }

  if (typeFilter && INCIDENT_TYPES.includes(typeFilter as typeof INCIDENT_TYPES[number])) {
    conditions.push(`i.incident_type = $${paramIndex}`);
    conditionParams.push(typeFilter);
    paramIndex++;
  }

  if (statusFilter && INCIDENT_STATUSES.includes(statusFilter as typeof INCIDENT_STATUSES[number])) {
    conditions.push(`i.status = $${paramIndex}`);
    conditionParams.push(statusFilter);
    paramIndex++;
  }

  if (severityFilter && SEVERITY_LEVELS.includes(severityFilter as typeof SEVERITY_LEVELS[number])) {
    conditions.push(`i.severity = $${paramIndex}`);
    conditionParams.push(severityFilter);
    paramIndex++;
  }

  if (siteFilter) {
    conditions.push(`i.site_id = $${paramIndex}`);
    conditionParams.push(siteFilter);
    paramIndex++;
  }

  const whereExtra = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*)::int AS count
    FROM incidents i
    WHERE i.org_id = $1${whereExtra}`;

  const countResult = await db.rawQuery<{ count: number }>(
    countSql,
    [ctx.orgId, ...conditionParams],
  );
  const totalCount = countResult[0]?.count ?? 0;

  const dataSql = `SELECT
      i.*,
      s.name AS site_name,
      a.asset_code
    FROM incidents i
    INNER JOIN sites s ON i.site_id = s.id
    LEFT JOIN assets a ON i.asset_id = a.id
    WHERE i.org_id = $1${whereExtra}
    ORDER BY i.${sortBy} ${sortDir === 'asc' ? 'ASC' : 'DESC'}
    LIMIT ${limit} OFFSET ${offset}`;

  const incidents = await db.rawQuery(
    dataSql,
    [ctx.orgId, ...conditionParams],
  );

  return jsonResponse({
    success: true,
    data: incidents,
    meta: buildPaginationMeta(pagination, totalCount),
  }, ctx.requestId);
}

// =============================================
// GET INCIDENT
// =============================================

export async function getIncident(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  const rows = await db.rawQuery<Record<string, unknown>>(
    `SELECT
      i.*,
      s.name AS site_name,
      a.asset_code,
      a.asset_type,
      d.description AS defect_description,
      d.severity AS defect_severity,
      d.status AS defect_status
    FROM incidents i
    INNER JOIN sites s ON i.site_id = s.id
    LEFT JOIN assets a ON i.asset_id = a.id
    LEFT JOIN defects d ON i.defect_id = d.id
    WHERE i.org_id = $1 AND i.id = $2
    LIMIT 1`,
    [ctx.orgId, id],
  );

  if (!rows[0]) {
    throw new NotFoundError('Incident not found');
  }

  return jsonResponse({
    success: true,
    data: rows[0],
  }, ctx.requestId);
}

// =============================================
// CREATE INCIDENT
// =============================================

export async function createIncident(
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

  // Validate optional asset belongs to site
  let assetId: string | null = null;
  if (body['asset_id']) {
    assetId = validateUUID(body['asset_id'], 'asset_id');
    const assetCheck = await db.rawQuery<{ id: string }>(
      `SELECT a.id FROM assets a
       INNER JOIN sites s ON a.site_id = s.id
       WHERE s.org_id = $1 AND a.id = $2 AND a.site_id = $3
       LIMIT 1`,
      [ctx.orgId, assetId, siteId],
    );
    if (!assetCheck[0]) {
      throw new NotFoundError('Asset not found or does not belong to this site');
    }
  }

  // Validate optional defect belongs to this org
  let defectId: string | null = null;
  if (body['defect_id']) {
    defectId = validateUUID(body['defect_id'], 'defect_id');
    const defectCheck = await db.rawQuery<{ id: string }>(
      `SELECT d.id FROM defects d
       INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
       INNER JOIN inspections insp ON ii.inspection_id = insp.id
       WHERE insp.org_id = $1 AND d.id = $2
       LIMIT 1`,
      [ctx.orgId, defectId],
    );
    if (!defectCheck[0]) {
      throw new NotFoundError('Defect not found');
    }
  }

  const incidentDate = validateString(body['incident_date'], 'incident_date', { maxLength: 10 });

  const data: Record<string, unknown> = {
    id: typeof body['id'] === 'string' && body['id'].length > 0
      ? validateUUID(body['id'], 'id')
      : crypto.randomUUID(),
    org_id: ctx.orgId,
    site_id: siteId,
    asset_id: assetId,
    defect_id: defectId,
    incident_date: incidentDate,
    incident_time: validateOptionalString(body['incident_time'], 'incident_time', { maxLength: 8 }),
    incident_type: validateOptionalEnum(body['incident_type'], 'incident_type', INCIDENT_TYPES) ?? 'other',
    severity: validateOptionalEnum(body['severity'], 'severity', SEVERITY_LEVELS) ?? 'minor',
    description: validateString(body['description'], 'description', { maxLength: 5000 }),
    location_on_site: validateOptionalString(body['location_on_site'], 'location_on_site', { maxLength: 500 }),
    reported_by: validateString(body['reported_by'], 'reported_by', { maxLength: 200 }),
    reporter_contact: validateOptionalString(body['reporter_contact'], 'reporter_contact', { maxLength: 200 }),
    reporter_role: validateOptionalString(body['reporter_role'], 'reporter_role', { maxLength: 100 }),
    injured_party_name: validateOptionalString(body['injured_party_name'], 'injured_party_name', { maxLength: 200 }),
    injured_party_age: validateOptionalNumber(body['injured_party_age'], 'injured_party_age', { min: 0, max: 150, integer: true }),
    injured_party_contact: validateOptionalString(body['injured_party_contact'], 'injured_party_contact', { maxLength: 200 }),
    injury_description: validateOptionalString(body['injury_description'], 'injury_description', { maxLength: 2000 }),
    body_part_affected: validateOptionalString(body['body_part_affected'], 'body_part_affected', { maxLength: 200 }),
    immediate_action: validateOptionalString(body['immediate_action'], 'immediate_action', { maxLength: 2000 }),
    ambulance_called: validateOptionalBoolean(body['ambulance_called'], 'ambulance_called', false),
    first_aid_given: validateOptionalBoolean(body['first_aid_given'], 'first_aid_given', false),
    area_closed: validateOptionalBoolean(body['area_closed'], 'area_closed', false),
    equipment_isolated: validateOptionalBoolean(body['equipment_isolated'], 'equipment_isolated', false),
    witness_details: validateOptionalString(body['witness_details'], 'witness_details', { maxLength: 2000 }),
    reported_to_riddor: validateOptionalBoolean(body['reported_to_riddor'], 'reported_to_riddor', false),
    riddor_reference: validateOptionalString(body['riddor_reference'], 'riddor_reference', { maxLength: 100 }),
    police_reference: validateOptionalString(body['police_reference'], 'police_reference', { maxLength: 100 }),
    hse_notified: validateOptionalBoolean(body['hse_notified'], 'hse_notified', false),
    status: validateOptionalEnum(body['status'], 'status', INCIDENT_STATUSES) ?? 'open',
    claim_reference: validateOptionalString(body['claim_reference'], 'claim_reference', { maxLength: 100 }),
    claim_received_date: validateOptionalISODate(body['claim_received_date'], 'claim_received_date'),
    claimant_solicitor: validateOptionalString(body['claimant_solicitor'], 'claimant_solicitor', { maxLength: 200 }),
    insurer_notified: validateOptionalBoolean(body['insurer_notified'], 'insurer_notified', false),
    insurer_reference: validateOptionalString(body['insurer_reference'], 'insurer_reference', { maxLength: 100 }),
    internal_notes: validateOptionalString(body['internal_notes'], 'internal_notes', { maxLength: 5000 }),
    investigation_findings: validateOptionalString(body['investigation_findings'], 'investigation_findings', { maxLength: 5000 }),
    corrective_actions: validateOptionalString(body['corrective_actions'], 'corrective_actions', { maxLength: 5000 }),
    created_by_id: ctx.userId,
    created_by_name: ctx.userName ?? 'Unknown',
  };

  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const now = new Date().toISOString();

  const insertSql = `INSERT INTO incidents (${columns.join(', ')}, created_at, updated_at)
    VALUES (${placeholders.join(', ')}, $${values.length + 1}, $${values.length + 2})
    RETURNING *`;

  const rows = await db.rawQuery<Record<string, unknown>>(
    insertSql,
    [...values, now, now],
  );

  void writeAuditLog(ctx, 'incident.created', 'incidents', data['id'] as string, {
    incident_type: data['incident_type'],
    severity: data['severity'],
    site_id: siteId,
    incident_date: incidentDate,
  }, request);

  return jsonResponse({
    success: true,
    data: rows[0],
  }, ctx.requestId, 201);
}

// =============================================
// UPDATE INCIDENT
// =============================================

export async function updateIncident(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const id = validateUUID(params['id'], 'id');
  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  // Verify incident exists and belongs to this org
  const existingRows = await db.rawQuery<Record<string, unknown>>(
    `SELECT * FROM incidents WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [ctx.orgId, id],
  );

  if (!existingRows[0]) {
    throw new NotFoundError('Incident not found');
  }

  const existing = existingRows[0];

  const data: Record<string, unknown> = {};

  if ('incident_date' in body) data['incident_date'] = validateString(body['incident_date'], 'incident_date', { maxLength: 10 });
  if ('incident_time' in body) data['incident_time'] = validateOptionalString(body['incident_time'], 'incident_time', { maxLength: 8 });
  if ('incident_type' in body) data['incident_type'] = validateOptionalEnum(body['incident_type'], 'incident_type', INCIDENT_TYPES);
  if ('severity' in body) data['severity'] = validateOptionalEnum(body['severity'], 'severity', SEVERITY_LEVELS);
  if ('description' in body) data['description'] = validateString(body['description'], 'description', { maxLength: 5000 });
  if ('location_on_site' in body) data['location_on_site'] = validateOptionalString(body['location_on_site'], 'location_on_site', { maxLength: 500 });
  if ('reported_by' in body) data['reported_by'] = validateString(body['reported_by'], 'reported_by', { maxLength: 200 });
  if ('reporter_contact' in body) data['reporter_contact'] = validateOptionalString(body['reporter_contact'], 'reporter_contact', { maxLength: 200 });
  if ('reporter_role' in body) data['reporter_role'] = validateOptionalString(body['reporter_role'], 'reporter_role', { maxLength: 100 });
  if ('injured_party_name' in body) data['injured_party_name'] = validateOptionalString(body['injured_party_name'], 'injured_party_name', { maxLength: 200 });
  if ('injured_party_age' in body) data['injured_party_age'] = validateOptionalNumber(body['injured_party_age'], 'injured_party_age', { min: 0, max: 150, integer: true });
  if ('injured_party_contact' in body) data['injured_party_contact'] = validateOptionalString(body['injured_party_contact'], 'injured_party_contact', { maxLength: 200 });
  if ('injury_description' in body) data['injury_description'] = validateOptionalString(body['injury_description'], 'injury_description', { maxLength: 2000 });
  if ('body_part_affected' in body) data['body_part_affected'] = validateOptionalString(body['body_part_affected'], 'body_part_affected', { maxLength: 200 });
  if ('immediate_action' in body) data['immediate_action'] = validateOptionalString(body['immediate_action'], 'immediate_action', { maxLength: 2000 });
  if ('ambulance_called' in body) data['ambulance_called'] = validateBoolean(body['ambulance_called'], 'ambulance_called');
  if ('first_aid_given' in body) data['first_aid_given'] = validateBoolean(body['first_aid_given'], 'first_aid_given');
  if ('area_closed' in body) data['area_closed'] = validateBoolean(body['area_closed'], 'area_closed');
  if ('equipment_isolated' in body) data['equipment_isolated'] = validateBoolean(body['equipment_isolated'], 'equipment_isolated');
  if ('witness_details' in body) data['witness_details'] = validateOptionalString(body['witness_details'], 'witness_details', { maxLength: 2000 });
  if ('reported_to_riddor' in body) data['reported_to_riddor'] = validateBoolean(body['reported_to_riddor'], 'reported_to_riddor');
  if ('riddor_reference' in body) data['riddor_reference'] = validateOptionalString(body['riddor_reference'], 'riddor_reference', { maxLength: 100 });
  if ('police_reference' in body) data['police_reference'] = validateOptionalString(body['police_reference'], 'police_reference', { maxLength: 100 });
  if ('hse_notified' in body) data['hse_notified'] = validateBoolean(body['hse_notified'], 'hse_notified');
  if ('status' in body) data['status'] = validateOptionalEnum(body['status'], 'status', INCIDENT_STATUSES);
  if ('claim_reference' in body) data['claim_reference'] = validateOptionalString(body['claim_reference'], 'claim_reference', { maxLength: 100 });
  if ('claim_received_date' in body) data['claim_received_date'] = validateOptionalISODate(body['claim_received_date'], 'claim_received_date');
  if ('claimant_solicitor' in body) data['claimant_solicitor'] = validateOptionalString(body['claimant_solicitor'], 'claimant_solicitor', { maxLength: 200 });
  if ('insurer_notified' in body) data['insurer_notified'] = validateBoolean(body['insurer_notified'], 'insurer_notified');
  if ('insurer_reference' in body) data['insurer_reference'] = validateOptionalString(body['insurer_reference'], 'insurer_reference', { maxLength: 100 });
  if ('internal_notes' in body) data['internal_notes'] = validateOptionalString(body['internal_notes'], 'internal_notes', { maxLength: 5000 });
  if ('investigation_findings' in body) data['investigation_findings'] = validateOptionalString(body['investigation_findings'], 'investigation_findings', { maxLength: 5000 });
  if ('corrective_actions' in body) data['corrective_actions'] = validateOptionalString(body['corrective_actions'], 'corrective_actions', { maxLength: 5000 });

  // Allow linking/unlinking asset and defect
  if ('asset_id' in body) {
    if (body['asset_id'] === null) {
      data['asset_id'] = null;
    } else {
      const aid = validateUUID(body['asset_id'], 'asset_id');
      const aCheck = await db.rawQuery<{ id: string }>(
        `SELECT a.id FROM assets a INNER JOIN sites s ON a.site_id = s.id
         WHERE s.org_id = $1 AND a.id = $2 LIMIT 1`,
        [ctx.orgId, aid],
      );
      if (!aCheck[0]) throw new NotFoundError('Asset not found');
      data['asset_id'] = aid;
    }
  }

  if ('defect_id' in body) {
    if (body['defect_id'] === null) {
      data['defect_id'] = null;
    } else {
      const did = validateUUID(body['defect_id'], 'defect_id');
      const dCheck = await db.rawQuery<{ id: string }>(
        `SELECT d.id FROM defects d
         INNER JOIN inspection_items ii ON d.inspection_item_id = ii.id
         INNER JOIN inspections insp ON ii.inspection_id = insp.id
         WHERE insp.org_id = $1 AND d.id = $2 LIMIT 1`,
        [ctx.orgId, did],
      );
      if (!dCheck[0]) throw new NotFoundError('Defect not found');
      data['defect_id'] = did;
    }
  }

  if (Object.keys(data).length === 0) {
    return jsonResponse({ success: true, data: existing }, ctx.requestId);
  }

  data['updated_at'] = new Date().toISOString();
  const setClauses = Object.keys(data).map((col, i) => `${col} = $${i + 1}`);
  const updateSql = `UPDATE incidents SET ${setClauses.join(', ')}
    WHERE id = $${Object.keys(data).length + 1} AND org_id = $${Object.keys(data).length + 2}
    RETURNING *`;

  const updatedRows = await db.rawQuery<Record<string, unknown>>(
    updateSql,
    [...Object.values(data), id, ctx.orgId],
  );

  const changes = buildChanges(existing, data);
  if (Object.keys(changes).length > 0) {
    void writeAuditLog(ctx, 'incident.updated', 'incidents', id, changes, request);
  }

  return jsonResponse({
    success: true,
    data: updatedRows[0] ?? existing,
  }, ctx.requestId);
}
