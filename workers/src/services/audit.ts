/**
 * InspectVoice — Audit Log Service
 * Immutable audit trail for all state-changing operations.
 *
 * Records who did what, when, to which entity, with what changes.
 * Critical for:
 * - Inspection sign-off audit trail (BS EN 1176-7 compliance)
 * - Debugging tenant isolation issues
 * - Security incident investigation
 * - Regulatory compliance
 *
 * Audit log entries are append-only — never updated or deleted.
 *
 * Build Standard: Autaimate v3 §5.1 — structured logs + requestId
 */

import type { RequestContext, WebhookContext } from '../types';
import { Logger } from '../shared/logger';

// =============================================
// AUDIT ACTIONS
// =============================================

/**
 * All auditable actions in the system.
 * Using string literals rather than enum for extensibility.
 */
export type AuditAction =
  // Sites
  | 'site.created'
  | 'site.updated'
  | 'site.archived'
  | 'site.restored'
  // Assets
  | 'asset.created'
  | 'asset.updated'
  | 'asset.decommissioned'
  // Inspections
  | 'inspection.created'
  | 'inspection.updated'
  | 'inspection.status_changed'
  | 'inspection.signed'
  | 'inspection.exported'
  // Inspection Items
  | 'inspection_item.created'
  | 'inspection_item.updated'
  | 'inspection_item.ai_processed'
  // Defects
  | 'defect.created'
  | 'defect.updated'
  | 'defect.assigned'
  | 'defect.resolved'
  | 'defect.verified'
  | 'defect.deferred'
  // Photos
  | 'photo.uploaded'
  | 'photo.deleted'
  // Audio
  | 'audio.uploaded'
  | 'audio.transcribed'
  // Users
  | 'user.created'
  | 'user.updated'
  | 'user.deactivated'
  // Organisation
  | 'org.settings_updated'
  | 'org.subscription_changed'
  // Security
  | 'auth.tenant_violation'
  | 'auth.role_violation';

// =============================================
// AUDIT ENTRY
// =============================================

export interface AuditEntry {
  readonly org_id: string;
  readonly user_id: string | null;
  readonly action: AuditAction;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly changes: Record<string, unknown> | null;
  readonly ip_address: string | null;
  readonly user_agent: string | null;
  readonly request_id: string;
}

// =============================================
// AUDIT SERVICE
// =============================================

/**
 * Write an audit log entry.
 *
 * This function is intentionally fire-and-forget — audit logging
 * should never block or fail the main request. Errors are caught
 * and logged but not rethrown.
 *
 * @param ctx — request context (provides orgId, userId, requestId)
 * @param action — what happened
 * @param entityType — what type of entity was affected
 * @param entityId — which specific entity
 * @param changes — what changed (old/new values for key fields)
 * @param request — original request (for IP/user-agent extraction)
 */
export async function writeAuditLog(
  ctx: RequestContext,
  action: AuditAction,
  entityType: string,
  entityId: string,
  changes: Record<string, unknown> | null = null,
  request?: Request,
): Promise<void> {
  try {
    const entry: AuditEntry = {
      org_id: ctx.orgId,
      user_id: ctx.userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      changes: changes ? sanitiseChanges(changes) : null,
      ip_address: extractIpAddress(request),
      user_agent: extractUserAgent(request),
      request_id: ctx.requestId,
    };

    // Insert into audit_log table
    // Using raw SQL to avoid the DatabaseService's org_id injection
    // (audit_log writes its own org_id from the entry)
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(ctx.env.DATABASE_URL);

    await sql(
      `INSERT INTO audit_log (
        org_id, user_id, action, entity_type, entity_id,
        changes, ip_address, user_agent, request_id, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        entry.org_id,
        entry.user_id,
        entry.action,
        entry.entity_type,
        entry.entity_id,
        entry.changes ? JSON.stringify(entry.changes) : null,
        entry.ip_address,
        entry.user_agent,
        entry.request_id,
      ],
    );
  } catch (error) {
    // Audit logging must never break the main request
    const logger = Logger.fromContext(ctx);
    logger.error('Failed to write audit log', error, {
      action,
      entityType,
      entityId,
    });
  }
}

/**
 * Write an audit log entry from a webhook context (no authenticated user).
 * Used for Stripe/Clerk webhook-triggered changes.
 */
export async function writeWebhookAuditLog(
  ctx: WebhookContext,
  orgId: string,
  action: AuditAction,
  entityType: string,
  entityId: string,
  changes: Record<string, unknown> | null = null,
): Promise<void> {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(ctx.env.DATABASE_URL);

    await sql(
      `INSERT INTO audit_log (
        org_id, user_id, action, entity_type, entity_id,
        changes, ip_address, user_agent, request_id, timestamp
      ) VALUES ($1, NULL, $2, $3, $4, $5, NULL, $6, $7, NOW())`,
      [
        orgId,
        action,
        entityType,
        entityId,
        changes ? JSON.stringify(sanitiseChanges(changes)) : null,
        'webhook',
        ctx.requestId,
      ],
    );
  } catch (error) {
    const logger = Logger.fromWebhookContext(ctx);
    logger.error('Failed to write webhook audit log', error, {
      action,
      entityType,
      entityId,
    });
  }
}

/**
 * Log a security violation (tenant or role access attempt).
 * These are always written and always logged at WARN level.
 */
export async function logSecurityViolation(
  ctx: RequestContext,
  violationType: 'auth.tenant_violation' | 'auth.role_violation',
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
  request?: Request,
): Promise<void> {
  const logger = Logger.fromContext(ctx);
  logger.warn('Security violation detected', {
    violationType,
    entityType,
    entityId,
    ...details,
  });

  await writeAuditLog(ctx, violationType, entityType, entityId, details, request);
}

// =============================================
// CHANGE TRACKING HELPERS
// =============================================

/**
 * Build a changes object showing old and new values for modified fields.
 * Useful for update operations.
 *
 * @param oldData — the record before update
 * @param newData — the fields being updated
 * @returns Object with { fieldName: { old: ..., new: ... } } for changed fields
 */
export function buildChanges(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> {
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  for (const [key, newValue] of Object.entries(newData)) {
    const oldValue = oldData[key];

    // Skip if values are the same
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      continue;
    }

    changes[key] = { old: oldValue, new: newValue };
  }

  return changes;
}

// =============================================
// INTERNAL HELPERS
// =============================================

/**
 * Sanitise changes object for storage.
 * Remove any sensitive fields that shouldn't be in the audit log.
 */
function sanitiseChanges(changes: Record<string, unknown>): Record<string, unknown> {
  const sanitised: Record<string, unknown> = {};
  const sensitiveKeys = new Set([
    'password', 'token', 'secret', 'api_key', 'stripe_secret',
    'webhook_secret', 'authorization', 'cookie',
  ]);

  for (const [key, value] of Object.entries(changes)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      sanitised[key] = '[REDACTED]';
    } else {
      sanitised[key] = value;
    }
  }

  return sanitised;
}

/**
 * Extract client IP address from request headers.
 * Cloudflare provides this via CF-Connecting-IP.
 * Returns null if not available (never fails).
 */
function extractIpAddress(request?: Request): string | null {
  if (!request) return null;

  // Cloudflare always sets this header
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;

  // Fallback
  const forwarded = request.headers.get('X-Forwarded-For');
  if (forwarded) {
    // Take the first IP (client IP)
    const firstIp = forwarded.split(',')[0]?.trim();
    return firstIp ?? null;
  }

  return null;
}

/**
 * Extract user agent from request headers.
 * Truncated to prevent storage of absurdly long strings.
 */
function extractUserAgent(request?: Request): string | null {
  if (!request) return null;

  const ua = request.headers.get('User-Agent');
  if (!ua) return null;

  // Truncate to 500 chars
  return ua.length > 500 ? ua.slice(0, 500) : ua;
}
