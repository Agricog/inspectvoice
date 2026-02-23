/**
 * InspectVoice — Organisation Route Handler
 * Organisation settings management.
 *
 * Endpoints:
 *   GET    /api/v1/org/settings    — Get organisation settings
 *   PUT    /api/v1/org/settings    — Update organisation settings (admin only)
 *
 * Organisation records are created by Clerk webhooks.
 * These endpoints manage extended settings (branding, defaults, compliance).
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams } from '../types';
import { createDb } from '../services/db';
import { writeAuditLog, buildChanges } from '../services/audit';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { requireRole } from '../middleware/guard';
import { NotFoundError } from '../shared/errors';
import {
  parseJsonBody,
  validateOptionalString,
  validateOptionalEmail,
  validateOptionalPhone,
  validateOptionalPostcode,
  validateOptionalBoolean,
  validateFrequencyDays,
} from '../shared/validation';
import { jsonResponse } from './helpers';

// =============================================
// GET ORG SETTINGS
// =============================================

export async function getOrgSettings(
  _request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const db = createDb(ctx);

  // Organisations are keyed by org_id (which IS the id in this table)
  const rows = await db.rawQuery<Record<string, unknown>>(
    `SELECT * FROM organisations WHERE org_id = $1 LIMIT 1`,
    [ctx.orgId],
  );

  if (!rows[0]) {
    // Org exists in Clerk but not yet synced to our DB
    return jsonResponse({
      success: true,
      data: {
        org_id: ctx.orgId,
        settings_complete: false,
      },
    }, ctx.requestId);
  }

  return jsonResponse({
    success: true,
    data: rows[0],
  }, ctx.requestId);
}

// =============================================
// UPDATE ORG SETTINGS
// =============================================

export async function updateOrgSettings(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  // Only admins can modify org settings
  requireRole(ctx, 'admin');

  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  const existingRows = await db.rawQuery<Record<string, unknown>>(
    `SELECT * FROM organisations WHERE org_id = $1 LIMIT 1`,
    [ctx.orgId],
  );

  const existing = existingRows[0];

  // Build update data
  const data: Record<string, unknown> = {};

  // Company details
  if ('company_name' in body) data['company_name'] = validateOptionalString(body['company_name'], 'company_name', { maxLength: 300 });
  if ('company_address' in body) data['company_address'] = validateOptionalString(body['company_address'], 'company_address', { maxLength: 500 });
  if ('company_postcode' in body) data['company_postcode'] = validateOptionalPostcode(body['company_postcode'], 'company_postcode');
  if ('company_phone' in body) data['company_phone'] = validateOptionalPhone(body['company_phone'], 'company_phone');
  if ('company_email' in body) data['company_email'] = validateOptionalEmail(body['company_email'], 'company_email');
  if ('company_website' in body) data['company_website'] = validateOptionalString(body['company_website'], 'company_website', { maxLength: 300 });
  if ('company_registration_number' in body) data['company_registration_number'] = validateOptionalString(body['company_registration_number'], 'company_registration_number', { maxLength: 50 });

  // Branding
  if ('logo_r2_key' in body) data['logo_r2_key'] = validateOptionalString(body['logo_r2_key'], 'logo_r2_key', { maxLength: 500 });
  if ('brand_colour' in body) data['brand_colour'] = validateOptionalString(body['brand_colour'], 'brand_colour', { maxLength: 7 });

  // Inspection defaults
  if ('default_routine_frequency_days' in body) data['default_routine_frequency_days'] = validateFrequencyDays(body['default_routine_frequency_days'], 'default_routine_frequency_days');
  if ('default_operational_frequency_days' in body) data['default_operational_frequency_days'] = validateFrequencyDays(body['default_operational_frequency_days'], 'default_operational_frequency_days');
  if ('default_annual_frequency_days' in body) data['default_annual_frequency_days'] = validateFrequencyDays(body['default_annual_frequency_days'], 'default_annual_frequency_days');

  // Compliance
  if ('accreditation_body' in body) data['accreditation_body'] = validateOptionalString(body['accreditation_body'], 'accreditation_body', { maxLength: 200 });
  if ('accreditation_number' in body) data['accreditation_number'] = validateOptionalString(body['accreditation_number'], 'accreditation_number', { maxLength: 100 });

  // Report settings
  if ('report_footer_text' in body) data['report_footer_text'] = validateOptionalString(body['report_footer_text'], 'report_footer_text', { maxLength: 1000 });
  if ('report_include_photos' in body) data['report_include_photos'] = validateOptionalBoolean(body['report_include_photos'], 'report_include_photos', true);
  if ('report_include_ai_analysis' in body) data['report_include_ai_analysis'] = validateOptionalBoolean(body['report_include_ai_analysis'], 'report_include_ai_analysis', true);

  // Feature flags
  if ('voice_capture_enabled' in body) data['voice_capture_enabled'] = validateOptionalBoolean(body['voice_capture_enabled'], 'voice_capture_enabled', true);
  if ('ai_analysis_enabled' in body) data['ai_analysis_enabled'] = validateOptionalBoolean(body['ai_analysis_enabled'], 'ai_analysis_enabled', true);

  // Metadata
  if ('metadata' in body) data['metadata'] = body['metadata'];

  if (Object.keys(data).length === 0) {
    return jsonResponse({ success: true, data: existing ?? { org_id: ctx.orgId } }, ctx.requestId);
  }

  if (existing) {
    data['updated_at'] = new Date().toISOString();

    const setClauses = Object.keys(data).map((col, i) => `${col} = $${i + 1}`);
    const updateSql = `UPDATE organisations SET ${setClauses.join(', ')} WHERE org_id = $${Object.keys(data).length + 1} RETURNING *`;

    const updatedRows = await db.rawQuery<Record<string, unknown>>(
      updateSql,
      [...Object.values(data), ctx.orgId],
    );

    const changes = buildChanges(existing, data);
    if (Object.keys(changes).length > 0) {
      void writeAuditLog(ctx, 'org.settings_updated', 'organisations', ctx.orgId, changes, request);
    }

    return jsonResponse({ success: true, data: updatedRows[0] }, ctx.requestId);
  } else {
    // Create org record if it doesn't exist yet
    const now = new Date().toISOString();
    const insertData = { org_id: ctx.orgId, ...data, created_at: now, updated_at: now };
    const columns = Object.keys(insertData);
    const values = Object.values(insertData);
    const placeholders = columns.map((_, i) => `$${i + 1}`);

    const insertSql = `INSERT INTO organisations (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const rows = await db.rawQuery<Record<string, unknown>>(insertSql, values);

    void writeAuditLog(ctx, 'org.settings_updated', 'organisations', ctx.orgId, data, request);

    return jsonResponse({ success: true, data: rows[0] }, ctx.requestId, 201);
  }
}
