/**
 * InspectVoice — Users Route Handler
 * Current user profile management.
 *
 * Endpoints:
 *   GET    /api/v1/users/me        — Get current user profile
 *   PUT    /api/v1/users/me        — Update current user profile (certs, preferences)
 *
 * User records are synced from Clerk via webhooks. These endpoints
 * manage the extended profile fields (certifications, inspection prefs)
 * that Clerk doesn't own.
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
  validateOptionalString,
  validateOptionalISODate,
  validateOptionalPhone,
  validateOptionalBoolean,
} from '../shared/validation';
import { jsonResponse } from './helpers';

// =============================================
// GET CURRENT USER
// =============================================

export async function getMe(
  _request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const db = createDb(ctx);

  // Users table has org_id for multi-tenancy
  const user = await db.findById<Record<string, unknown>>('users', ctx.userId);

  if (!user) {
    // User exists in Clerk but not yet in our DB (webhook hasn't fired yet)
    // Return a minimal profile
    return jsonResponse({
      success: true,
      data: {
        id: ctx.userId,
        org_id: ctx.orgId,
        role: ctx.userRole,
        profile_complete: false,
      },
    }, ctx.requestId);
  }

  return jsonResponse({
    success: true,
    data: user,
  }, ctx.requestId);
}

// =============================================
// UPDATE CURRENT USER
// =============================================

export async function updateMe(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const body = await parseJsonBody(request);
  const db = createDb(ctx);

  const existing = await db.findById<Record<string, unknown>>('users', ctx.userId);

  // Build update data — only allow profile fields, not role/org/auth fields
  const data: Record<string, unknown> = {};

  if ('display_name' in body) data['display_name'] = validateOptionalString(body['display_name'], 'display_name', { maxLength: 200 });
  if ('phone' in body) data['phone'] = validateOptionalPhone(body['phone'], 'phone');
  if ('job_title' in body) data['job_title'] = validateOptionalString(body['job_title'], 'job_title', { maxLength: 200 });

  // Certification fields
  if ('rpii_qualified' in body) data['rpii_qualified'] = validateOptionalBoolean(body['rpii_qualified'], 'rpii_qualified', false);
  if ('rpii_number' in body) data['rpii_number'] = validateOptionalString(body['rpii_number'], 'rpii_number', { maxLength: 50 });
  if ('rpii_expiry' in body) data['rpii_expiry'] = validateOptionalISODate(body['rpii_expiry'], 'rpii_expiry');
  if ('rpii_grade' in body) data['rpii_grade'] = validateOptionalString(body['rpii_grade'], 'rpii_grade', { maxLength: 50 });
  if ('other_qualifications' in body) data['other_qualifications'] = validateOptionalString(body['other_qualifications'], 'other_qualifications', { maxLength: 2000 });
  if ('insurance_provider' in body) data['insurance_provider'] = validateOptionalString(body['insurance_provider'], 'insurance_provider', { maxLength: 200 });
  if ('insurance_policy_number' in body) data['insurance_policy_number'] = validateOptionalString(body['insurance_policy_number'], 'insurance_policy_number', { maxLength: 100 });
  if ('insurance_expiry' in body) data['insurance_expiry'] = validateOptionalISODate(body['insurance_expiry'], 'insurance_expiry');

  // Preferences
  if ('preferred_voice_engine' in body) data['preferred_voice_engine'] = validateOptionalString(body['preferred_voice_engine'], 'preferred_voice_engine', { maxLength: 50 });
  if ('preferred_language' in body) data['preferred_language'] = validateOptionalString(body['preferred_language'], 'preferred_language', { maxLength: 10 });
  if ('notification_preferences' in body) data['notification_preferences'] = body['notification_preferences'];
  if ('metadata' in body) data['metadata'] = body['metadata'];

  if (Object.keys(data).length === 0) {
    return jsonResponse({ success: true, data: existing ?? { id: ctx.userId } }, ctx.requestId);
  }

  if (existing) {
    // Update existing user
    const updated = await db.updateById('users', ctx.userId, data);

    const changes = buildChanges(existing, data);
    if (Object.keys(changes).length > 0) {
      void writeAuditLog(ctx, 'user.updated', 'users', ctx.userId, changes, request);
    }

    return jsonResponse({ success: true, data: updated }, ctx.requestId);
  } else {
    // User doesn't exist yet — create with provided data
    const newUser = await db.insert('users', {
      id: ctx.userId,
      ...data,
      role: ctx.userRole,
    });

    void writeAuditLog(ctx, 'user.created', 'users', ctx.userId, data, request);

    return jsonResponse({ success: true, data: newUser }, ctx.requestId, 201);
  }
}
