/**
 * InspectVoice — Magic Link Routes
 * workers/src/routes/magicLinks.ts
 *
 * Two sides:
 *
 * Inspector-side (behind guard):
 *   POST /api/v1/magic-links           → Create a magic link
 *   GET  /api/v1/magic-links           → List magic links for a workspace
 *   DELETE /api/v1/magic-links/:id     → Revoke a magic link
 *
 * Public-side (no auth, token is the credential):
 *   Called from index.ts magic link handler with a verified MagicLinkContext.
 *   resolveMagicLinkResource() returns the actual file download.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon } from '@neondatabase/serverless';
import type { RequestContext, RouteParams, MagicLinkContext } from '../types';
import { requireRole } from '../middleware/guard';
import { validateRequiredString, validateEnum, validateNumber } from '../shared/validation';
import { BadRequestError, NotFoundError } from '../shared/errors';
import { Logger } from '../shared/logger';

// =============================================
// INSPECTOR-SIDE: CREATE MAGIC LINK
// =============================================

/**
 * POST /api/v1/magic-links
 * Create a magic link for a client workspace resource.
 * RBAC: manager+
 *
 * Body:
 *   resource_type: 'inspection_pdf' | 'defect_export' | 'sealed_bundle'
 *   resource_id: UUID of the resource
 *   client_workspace_id: UUID of the client workspace
 *   max_uses?: number (default 5, max 100)
 *   expires_in_hours?: number (default 72, max 720 = 30 days)
 *
 * Returns the plaintext token ONCE. It is never stored or retrievable again.
 */
export async function createMagicLink(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const logger = Logger.fromContext(ctx);

  const body = await request.json() as Record<string, unknown>;

  const resourceType = validateEnum(
    body['resource_type'],
    'resource_type',
    ['inspection_pdf', 'defect_export', 'sealed_bundle'] as const,
  );
  const resourceId = validateRequiredString(body['resource_id'], 'resource_id', { maxLength: 100 });
  const clientWorkspaceId = validateRequiredString(body['client_workspace_id'], 'client_workspace_id', { maxLength: 100 });

  const maxUses = typeof body['max_uses'] === 'number'
    ? validateNumber(body['max_uses'], 'max_uses', { min: 1, max: 100, integer: true })
    : 5;

  const expiresInHours = typeof body['expires_in_hours'] === 'number'
    ? validateNumber(body['expires_in_hours'], 'expires_in_hours', { min: 1, max: 720, integer: true })
    : 72;

  // Verify workspace is linked to inspector's org
  const providerRows = await sql`
    SELECT id FROM client_workspace_providers
    WHERE client_workspace_id = ${clientWorkspaceId}
      AND org_id = ${ctx.orgId}
      AND status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  // Verify the resource exists and belongs to inspector's org
  await verifyResourceOwnership(sql, resourceType, resourceId, ctx.orgId);

  // Generate a cryptographically secure token
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Hash the token — only the hash is stored
  const tokenHash = await sha256Hex(token);

  // Compute expiry
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  // Insert
  const rows = await sql`
    INSERT INTO client_magic_links (
      client_workspace_id, resource_type, resource_id,
      token_hash, created_by, expires_at, max_uses
    )
    VALUES (
      ${clientWorkspaceId}, ${resourceType}, ${resourceId},
      ${tokenHash}, ${ctx.userId}, ${expiresAt}, ${maxUses}
    )
    RETURNING id, resource_type, resource_id, expires_at, max_uses, created_at
  `;

  const link = rows[0];
  if (!link) throw new Error('Failed to create magic link');

  // Build the full magic link URL
  const baseUrl = ctx.env.ALLOWED_ORIGIN || 'https://inspectvoice-production.up.railway.app';
  const magicLinkUrl = `${baseUrl}/portal/magic/${token}`;

  // Audit
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (${ctx.orgId}, ${ctx.userId}, 'create', 'magic_link', ${link['id'] as string},
            ${JSON.stringify({ resource_type: resourceType, resource_id: resourceId, workspace_id: clientWorkspaceId })}, NOW())
  `;

  logger.info('Magic link created', { linkId: link['id'], resourceType });

  return new Response(JSON.stringify({
    success: true,
    data: {
      ...link,
      token,
      magic_link_url: magicLinkUrl,
    },
    requestId: ctx.requestId,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================
// INSPECTOR-SIDE: LIST MAGIC LINKS
// =============================================

/**
 * GET /api/v1/magic-links?client_workspace_id=xxx
 * List magic links for a workspace. RBAC: manager+
 */
export async function listMagicLinks(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const url = new URL(request.url);
  const clientWorkspaceId = url.searchParams.get('client_workspace_id');

  if (!clientWorkspaceId) {
    throw new BadRequestError('client_workspace_id query parameter is required');
  }

  // Verify ownership
  const providerRows = await sql`
    SELECT id FROM client_workspace_providers
    WHERE client_workspace_id = ${clientWorkspaceId}
      AND org_id = ${ctx.orgId}
      AND status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  const rows = await sql`
    SELECT
      id, resource_type, resource_id, expires_at, max_uses, use_count,
      first_accessed_at, last_accessed_at, created_by, created_at,
      CASE
        WHEN use_count >= max_uses THEN 'exhausted'
        WHEN expires_at < NOW() THEN 'expired'
        ELSE 'active'
      END AS status
    FROM client_magic_links
    WHERE client_workspace_id = ${clientWorkspaceId}
    ORDER BY created_at DESC
    LIMIT 50
  `;

  return new Response(JSON.stringify({
    success: true,
    data: rows,
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================
// INSPECTOR-SIDE: REVOKE MAGIC LINK
// =============================================

/**
 * DELETE /api/v1/magic-links/:id
 * Revoke by setting max_uses = use_count (effectively exhausted).
 * RBAC: manager+
 */
export async function revokeMagicLink(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const logger = Logger.fromContext(ctx);
  const linkId = params['id'];
  if (!linkId) throw new BadRequestError('Missing magic link ID');

  // Verify the link belongs to a workspace linked to inspector's org
  const checkRows = await sql`
    SELECT cml.id
    FROM client_magic_links cml
    INNER JOIN client_workspace_providers cwp
      ON cwp.client_workspace_id = cml.client_workspace_id
      AND cwp.org_id = ${ctx.orgId}
      AND cwp.status = 'active'
    WHERE cml.id = ${linkId}
    LIMIT 1
  `;

  if (checkRows.length === 0) {
    throw new NotFoundError('Magic link not found');
  }

  // Revoke by exhausting uses
  await sql`
    UPDATE client_magic_links
    SET max_uses = use_count
    WHERE id = ${linkId}
  `;

  // Audit
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (${ctx.orgId}, ${ctx.userId}, 'revoke', 'magic_link', ${linkId},
            ${JSON.stringify({ revoked: true })}, NOW())
  `;

  logger.info('Magic link revoked', { linkId });

  return new Response(JSON.stringify({
    success: true,
    data: { revoked: true },
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================
// PUBLIC-SIDE: RESOLVE MAGIC LINK RESOURCE
// =============================================

/**
 * Called from index.ts after verifyMagicLink() succeeds.
 * Returns the actual resource (PDF binary, Excel binary, or redirect).
 */
export async function resolveMagicLinkResource(
  _request: Request,
  ctx: MagicLinkContext,
): Promise<Response> {
  const sql = neon(ctx.env.DATABASE_URL);

  switch (ctx.resourceType) {
    case 'inspection_pdf': {
      // Get PDF URL from inspections table
      const rows = await sql`
        SELECT pdf_url FROM inspections
        WHERE id = ${ctx.resourceId}
          AND status IN ('signed', 'exported')
        LIMIT 1
      `;
      const inspection = rows[0] as { pdf_url: string | null } | undefined;
      if (!inspection || !inspection.pdf_url) {
        return jsonResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'PDF not available', requestId: ctx.requestId } });
      }

      // Fetch from R2 and return binary
      const r2Object = await ctx.env.INSPECTVOICE_BUCKET.get(inspection.pdf_url);
      if (!r2Object) {
        return jsonResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'PDF file not found in storage', requestId: ctx.requestId } });
      }

      return new Response(r2Object.body, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="inspection-report-${ctx.resourceId}.pdf"`,
          'X-Request-Id': ctx.requestId,
        },
      });
    }

    case 'defect_export': {
      // defect_export resource_id could be an org-scoped export key
      // For now, return the resource metadata — full download in future iteration
      return jsonResponse(200, {
        success: true,
        data: {
          resource_type: 'defect_export',
          resource_id: ctx.resourceId,
          message: 'Defect export download will be available in a future update.',
        },
        requestId: ctx.requestId,
      });
    }

    case 'sealed_bundle': {
      // Get sealed bundle from R2
      const rows = await sql`
        SELECT r2_key, export_type FROM sealed_exports
        WHERE bundle_id = ${ctx.resourceId}
        LIMIT 1
      `;
      const bundle = rows[0] as { r2_key: string; export_type: string } | undefined;
      if (!bundle) {
        return jsonResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Sealed bundle not found', requestId: ctx.requestId } });
      }

      const r2Object = await ctx.env.INSPECTVOICE_BUCKET.get(bundle.r2_key);
      if (!r2Object) {
        return jsonResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'Bundle file not found in storage', requestId: ctx.requestId } });
      }

      return new Response(r2Object.body, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="InspectVoice_Bundle_${ctx.resourceId}.zip"`,
          'X-Request-Id': ctx.requestId,
        },
      });
    }

    default:
      return jsonResponse(400, {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Unknown resource type', requestId: ctx.requestId },
      });
  }
}

// =============================================
// HELPERS
// =============================================

/**
 * Verify that a resource exists and belongs to the inspector's org.
 */
async function verifyResourceOwnership(
  sql: ReturnType<typeof neon>,
  resourceType: string,
  resourceId: string,
  orgId: string,
): Promise<void> {
  switch (resourceType) {
    case 'inspection_pdf': {
      const rows = await sql`
        SELECT id FROM inspections
        WHERE id = ${resourceId} AND org_id = ${orgId}
          AND status IN ('signed', 'exported')
        LIMIT 1
      `;
      if (rows.length === 0) throw new NotFoundError('Inspection not found or not signed');
      break;
    }
    case 'sealed_bundle': {
      const rows = await sql`
        SELECT id FROM sealed_exports
        WHERE bundle_id = ${resourceId} AND org_id = ${orgId}
        LIMIT 1
      `;
      if (rows.length === 0) throw new NotFoundError('Sealed bundle not found');
      break;
    }
    case 'defect_export': {
      // Defect exports are org-wide, just verify org exists
      break;
    }
    default:
      throw new BadRequestError('Invalid resource type');
  }
}

/** SHA-256 hash a string → hex */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Quick JSON response helper */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
