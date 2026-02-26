/**
 * InspectVoice — Client Workspace Management Routes (Inspector-Side)
 * workers/src/routes/clientWorkspaces.ts
 *
 * These routes are for the INSPECTION COMPANY to manage their clients.
 * They sit behind the regular inspector guard (not portalGuard) and use
 * the inspector's orgId for tenant isolation.
 *
 * Endpoints:
 *   Workspaces:
 *     POST   /api/v1/client-workspaces                  → Create workspace
 *     GET    /api/v1/client-workspaces                  → List workspaces
 *     GET    /api/v1/client-workspaces/:id              → Get workspace
 *     PUT    /api/v1/client-workspaces/:id              → Update workspace
 *
 *   Client Users:
 *     POST   /api/v1/client-workspaces/:id/users        → Invite client user
 *     GET    /api/v1/client-workspaces/:id/users        → List client users
 *     PUT    /api/v1/client-workspaces/:id/users/:userId → Update client user
 *     DELETE /api/v1/client-workspaces/:id/users/:userId → Deactivate client user
 *
 *   Site Access:
 *     POST   /api/v1/client-workspaces/:id/sites        → Grant site access
 *     GET    /api/v1/client-workspaces/:id/sites        → List granted sites
 *     DELETE /api/v1/client-workspaces/:id/sites/:siteId → Revoke site access
 *
 *   Verification Queue:
 *     GET    /api/v1/client-updates/pending              → Unverified client updates
 *     PUT    /api/v1/client-updates/:id/verify           → Verify a client update
 *
 * RBAC: manager or admin for all workspace/user/site management.
 *       inspector+ for verification queue (they verify their own inspections).
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon } from '@neondatabase/serverless';
import type { RequestContext, RouteParams, RouteHandler } from '../types';
import { requireRole } from '../middleware/guard';
import { validateRequiredString, validateOptionalString } from '../shared/validation';
import { BadRequestError, NotFoundError, ConflictError } from '../shared/errors';
import { Logger } from '../shared/logger';

// =============================================
// WORKSPACE CRUD
// =============================================

/**
 * POST /api/v1/client-workspaces
 * Create a new client workspace and link it to the inspector's org.
 * RBAC: manager+
 */
export const createClientWorkspace: RouteHandler = async (request, _params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const logger = Logger.fromContext(ctx);

  const body = await request.json() as Record<string, unknown>;

  const name = validateRequiredString(body['name'] as string | undefined, 'name', 200);
  const slug = validateRequiredString(body['slug'] as string | undefined, 'slug', 100);
  const clerkOrgId = validateRequiredString(body['clerk_org_id'] as string | undefined, 'clerk_org_id', 200);

  // Validate slug format: lowercase alphanumeric + hyphens
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    throw new BadRequestError('Slug must be lowercase alphanumeric with hyphens, no leading/trailing hyphens');
  }

  // Check slug uniqueness
  const existingSlug = await sql`
    SELECT id FROM client_workspaces WHERE slug = ${slug} LIMIT 1
  `;
  if (existingSlug.length > 0) {
    throw new ConflictError('A workspace with this slug already exists');
  }

  // Check clerk_org_id uniqueness
  const existingClerk = await sql`
    SELECT id FROM client_workspaces WHERE clerk_org_id = ${clerkOrgId} LIMIT 1
  `;
  if (existingClerk.length > 0) {
    throw new ConflictError('A workspace is already linked to this Clerk organisation');
  }

  const branding = typeof body['branding'] === 'object' && body['branding'] !== null
    ? body['branding'] as Record<string, unknown>
    : {};
  const settings = typeof body['settings'] === 'object' && body['settings'] !== null
    ? body['settings'] as Record<string, unknown>
    : { powered_by_visible: true };

  // Create workspace
  const workspaceRows = await sql`
    INSERT INTO client_workspaces (clerk_org_id, name, slug, branding, settings)
    VALUES (${clerkOrgId}, ${name}, ${slug}, ${JSON.stringify(branding)}, ${JSON.stringify(settings)})
    RETURNING id, clerk_org_id, name, slug, branding, settings, status, created_at
  `;

  const workspace = workspaceRows[0];
  if (!workspace) {
    throw new Error('Failed to create client workspace');
  }

  // Link workspace to inspector's org
  await sql`
    INSERT INTO client_workspace_providers (client_workspace_id, org_id, linked_by)
    VALUES (${workspace['id'] as string}, ${ctx.orgId}, ${ctx.userId})
  `;

  // Audit log
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (${ctx.orgId}, ${ctx.userId}, 'create', 'client_workspace', ${workspace['id'] as string},
            ${JSON.stringify({ name, slug, clerk_org_id: clerkOrgId })}, NOW())
  `;

  logger.info('Client workspace created', { workspaceId: workspace['id'] });

  return new Response(JSON.stringify({
    success: true,
    data: workspace,
    requestId: ctx.requestId,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * GET /api/v1/client-workspaces
 * List all client workspaces linked to the inspector's org.
 * RBAC: manager+
 */
export const listClientWorkspaces: RouteHandler = async (_request, _params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);

  const rows = await sql`
    SELECT
      cw.id, cw.clerk_org_id, cw.name, cw.slug, cw.branding, cw.settings,
      cw.status, cw.created_at, cw.updated_at,
      (SELECT COUNT(*) FROM client_users cu WHERE cu.client_workspace_id = cw.id AND cu.is_active = TRUE)::INTEGER AS active_users,
      (SELECT COUNT(*) FROM client_site_access csa WHERE csa.client_workspace_id = cw.id)::INTEGER AS sites_granted
    FROM client_workspaces cw
    INNER JOIN client_workspace_providers cwp
      ON cwp.client_workspace_id = cw.id
      AND cwp.org_id = ${ctx.orgId}
      AND cwp.status = 'active'
    ORDER BY cw.name ASC
  `;

  return new Response(JSON.stringify({
    success: true,
    data: rows,
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * GET /api/v1/client-workspaces/:id
 * Get a single client workspace with stats.
 * RBAC: manager+
 */
export const getClientWorkspace: RouteHandler = async (_request, params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const workspaceId = params['id'];
  if (!workspaceId) throw new BadRequestError('Missing workspace ID');

  // Verify workspace is linked to inspector's org
  const providerRows = await sql`
    SELECT cwp.id FROM client_workspace_providers cwp
    WHERE cwp.client_workspace_id = ${workspaceId}
      AND cwp.org_id = ${ctx.orgId}
      AND cwp.status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  const rows = await sql`
    SELECT
      cw.id, cw.clerk_org_id, cw.name, cw.slug, cw.branding, cw.settings,
      cw.status, cw.created_at, cw.updated_at
    FROM client_workspaces cw
    WHERE cw.id = ${workspaceId}
    LIMIT 1
  `;

  const workspace = rows[0];
  if (!workspace) throw new NotFoundError('Client workspace not found');

  // Get users + sites in parallel
  const [users, sites] = await Promise.all([
    sql`
      SELECT id, name, email, role, job_title, is_active, last_login_at, created_at
      FROM client_users
      WHERE client_workspace_id = ${workspaceId}
      ORDER BY name ASC
    `,
    sql`
      SELECT csa.id, csa.site_id, csa.access_level, csa.granted_at,
             s.name AS site_name, s.postcode
      FROM client_site_access csa
      INNER JOIN sites s ON s.id = csa.site_id
      WHERE csa.client_workspace_id = ${workspaceId}
      ORDER BY s.name ASC
    `,
  ]);

  return new Response(JSON.stringify({
    success: true,
    data: {
      ...workspace,
      users,
      sites,
    },
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * PUT /api/v1/client-workspaces/:id
 * Update workspace name, branding, settings, or status.
 * RBAC: manager+
 */
export const updateClientWorkspace: RouteHandler = async (request, params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const logger = Logger.fromContext(ctx);
  const workspaceId = params['id'];
  if (!workspaceId) throw new BadRequestError('Missing workspace ID');

  // Verify ownership
  const providerRows = await sql`
    SELECT id FROM client_workspace_providers
    WHERE client_workspace_id = ${workspaceId}
      AND org_id = ${ctx.orgId}
      AND status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const changes: Record<string, unknown> = {};

  if (body['name'] !== undefined) {
    const name = validateRequiredString(body['name'] as string, 'name', 200);
    changes['name'] = name;
  }
  if (body['branding'] !== undefined) {
    changes['branding'] = body['branding'];
  }
  if (body['settings'] !== undefined) {
    changes['settings'] = body['settings'];
  }
  if (body['status'] !== undefined) {
    const status = body['status'] as string;
    if (!['active', 'suspended', 'archived'].includes(status)) {
      throw new BadRequestError('Invalid status. Must be: active, suspended, archived');
    }
    changes['status'] = status;
  }

  if (Object.keys(changes).length === 0) {
    throw new BadRequestError('No valid fields to update');
  }

  // Build dynamic update (safe — keys are validated above)
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (changes['name'] !== undefined) {
    setClauses.push(`name = $${values.length + 1}`);
    values.push(changes['name']);
  }
  if (changes['branding'] !== undefined) {
    setClauses.push(`branding = $${values.length + 1}::jsonb`);
    values.push(JSON.stringify(changes['branding']));
  }
  if (changes['settings'] !== undefined) {
    setClauses.push(`settings = $${values.length + 1}::jsonb`);
    values.push(JSON.stringify(changes['settings']));
  }
  if (changes['status'] !== undefined) {
    setClauses.push(`status = $${values.length + 1}`);
    values.push(changes['status']);
  }

  // Use tagged template for the update — simpler and safer with neon
  const rows = await sql`
    UPDATE client_workspaces
    SET
      name = COALESCE(${changes['name'] as string ?? null}, name),
      branding = COALESCE(${changes['branding'] !== undefined ? JSON.stringify(changes['branding']) : null}::jsonb, branding),
      settings = COALESCE(${changes['settings'] !== undefined ? JSON.stringify(changes['settings']) : null}::jsonb, settings),
      status = COALESCE(${changes['status'] as string ?? null}, status)
    WHERE id = ${workspaceId}
    RETURNING id, clerk_org_id, name, slug, branding, settings, status, updated_at
  `;

  const updated = rows[0];
  if (!updated) throw new NotFoundError('Client workspace not found');

  // Audit
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (${ctx.orgId}, ${ctx.userId}, 'update', 'client_workspace', ${workspaceId},
            ${JSON.stringify(changes)}, NOW())
  `;

  logger.info('Client workspace updated', { workspaceId });

  return new Response(JSON.stringify({
    success: true,
    data: updated,
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// =============================================
// CLIENT USER MANAGEMENT
// =============================================

/**
 * POST /api/v1/client-workspaces/:id/users
 * Invite a client user to a workspace.
 * RBAC: manager+
 *
 * Note: This creates the DB record. The actual Clerk invitation is handled
 * separately via Clerk's invitation API from the frontend. The clerk_user_id
 * is populated when the user accepts the invitation and their Clerk webhook fires.
 */
export const inviteClientUser: RouteHandler = async (request, params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const logger = Logger.fromContext(ctx);
  const workspaceId = params['id'];
  if (!workspaceId) throw new BadRequestError('Missing workspace ID');

  // Verify ownership
  const providerRows = await sql`
    SELECT id FROM client_workspace_providers
    WHERE client_workspace_id = ${workspaceId}
      AND org_id = ${ctx.orgId}
      AND status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  const body = await request.json() as Record<string, unknown>;

  const email = validateRequiredString(body['email'] as string | undefined, 'email', 255);
  const name = validateRequiredString(body['name'] as string | undefined, 'name', 200);
  const role = (body['role'] as string) ?? 'viewer';
  const jobTitle = validateOptionalString(body['job_title'] as string | undefined, 'job_title', 200);

  if (!['viewer', 'contributor', 'admin'].includes(role)) {
    throw new BadRequestError('Invalid role. Must be: viewer, contributor, admin');
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestError('Invalid email format');
  }

  // Check for existing user with same email in this workspace
  const existing = await sql`
    SELECT id, is_active FROM client_users
    WHERE client_workspace_id = ${workspaceId}
      AND email = ${email.toLowerCase()}
    LIMIT 1
  `;

  if (existing.length > 0) {
    const existingUser = existing[0] as { id: string; is_active: boolean };
    if (existingUser.is_active) {
      throw new ConflictError('A user with this email already exists in this workspace');
    }
    // Reactivate if previously deactivated
    const reactivated = await sql`
      UPDATE client_users
      SET is_active = TRUE, name = ${name}, role = ${role},
          job_title = ${jobTitle}, invited_by = ${ctx.userId}, invited_at = NOW()
      WHERE id = ${existingUser.id}
      RETURNING id, clerk_user_id, name, email, role, job_title, is_active, created_at
    `;
    return new Response(JSON.stringify({
      success: true,
      data: reactivated[0],
      requestId: ctx.requestId,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Site access grants (optional — grant access to specific sites on invite)
  const siteIds = Array.isArray(body['site_ids']) ? body['site_ids'] as string[] : [];

  // Create user record — clerk_user_id is placeholder until Clerk webhook fires
  // We use a temporary placeholder that gets replaced when they accept the invitation
  const placeholderClerkId = `pending_${crypto.randomUUID()}`;

  const rows = await sql`
    INSERT INTO client_users (
      clerk_user_id, client_workspace_id, role, name, email,
      job_title, invited_by, invited_at
    )
    VALUES (
      ${placeholderClerkId}, ${workspaceId}, ${role}, ${name},
      ${email.toLowerCase()}, ${jobTitle}, ${ctx.userId}, NOW()
    )
    RETURNING id, clerk_user_id, name, email, role, job_title, is_active, invited_at, created_at
  `;

  const newUser = rows[0];
  if (!newUser) throw new Error('Failed to create client user');

  // Grant site access if site_ids provided
  if (siteIds.length > 0) {
    for (const siteId of siteIds) {
      // Verify site belongs to inspector's org
      const siteCheck = await sql`
        SELECT id FROM sites WHERE id = ${siteId} AND org_id = ${ctx.orgId} LIMIT 1
      `;
      if (siteCheck.length > 0) {
        await sql`
          INSERT INTO client_site_access (client_workspace_id, site_id, granted_by)
          VALUES (${workspaceId}, ${siteId}, ${ctx.userId})
          ON CONFLICT (client_workspace_id, site_id) DO NOTHING
        `;
      }
    }
  }

  // Audit
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (${ctx.orgId}, ${ctx.userId}, 'invite', 'client_user', ${newUser['id'] as string},
            ${JSON.stringify({ email, name, role, workspace_id: workspaceId })}, NOW())
  `;

  logger.info('Client user invited', { userId: newUser['id'], email });

  return new Response(JSON.stringify({
    success: true,
    data: newUser,
    requestId: ctx.requestId,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * GET /api/v1/client-workspaces/:id/users
 * List all client users in a workspace.
 * RBAC: manager+
 */
export const listClientUsers: RouteHandler = async (_request, params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const workspaceId = params['id'];
  if (!workspaceId) throw new BadRequestError('Missing workspace ID');

  // Verify ownership
  const providerRows = await sql`
    SELECT id FROM client_workspace_providers
    WHERE client_workspace_id = ${workspaceId}
      AND org_id = ${ctx.orgId}
      AND status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  const rows = await sql`
    SELECT
      id, clerk_user_id, name, email, role, job_title,
      notification_preferences, site_subscriptions,
      is_active, invited_by, invited_at, last_login_at, created_at
    FROM client_users
    WHERE client_workspace_id = ${workspaceId}
    ORDER BY is_active DESC, name ASC
  `;

  return new Response(JSON.stringify({
    success: true,
    data: rows,
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * PUT /api/v1/client-workspaces/:id/users/:userId
 * Update a client user's role, name, or status.
 * RBAC: manager+
 */
export const updateClientUser: RouteHandler = async (request, params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const logger = Logger.fromContext(ctx);
  const workspaceId = params['id'];
  const userId = params['userId'];
  if (!workspaceId || !userId) throw new BadRequestError('Missing workspace or user ID');

  // Verify ownership
  const providerRows = await sql`
    SELECT id FROM client_workspace_providers
    WHERE client_workspace_id = ${workspaceId}
      AND org_id = ${ctx.orgId}
      AND status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  const body = await request.json() as Record<string, unknown>;

  const rows = await sql`
    UPDATE client_users
    SET
      name = COALESCE(${body['name'] as string ?? null}, name),
      role = COALESCE(${body['role'] as string ?? null}, role),
      job_title = COALESCE(${body['job_title'] as string ?? null}, job_title),
      notification_preferences = COALESCE(
        ${body['notification_preferences'] !== undefined ? JSON.stringify(body['notification_preferences']) : null}::jsonb,
        notification_preferences
      ),
      site_subscriptions = COALESCE(
        ${body['site_subscriptions'] !== undefined ? (body['site_subscriptions'] as string[]) : null},
        site_subscriptions
      )
    WHERE id = ${userId}
      AND client_workspace_id = ${workspaceId}
    RETURNING id, name, email, role, job_title, notification_preferences, site_subscriptions, is_active
  `;

  const updated = rows[0];
  if (!updated) throw new NotFoundError('Client user not found');

  // Audit
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (${ctx.orgId}, ${ctx.userId}, 'update', 'client_user', ${userId},
            ${JSON.stringify(body)}, NOW())
  `;

  logger.info('Client user updated', { clientUserId: userId });

  return new Response(JSON.stringify({
    success: true,
    data: updated,
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * DELETE /api/v1/client-workspaces/:id/users/:userId
 * Soft-deactivate a client user.
 * RBAC: manager+
 */
export const deactivateClientUser: RouteHandler = async (_request, params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const logger = Logger.fromContext(ctx);
  const workspaceId = params['id'];
  const userId = params['userId'];
  if (!workspaceId || !userId) throw new BadRequestError('Missing workspace or user ID');

  // Verify ownership
  const providerRows = await sql`
    SELECT id FROM client_workspace_providers
    WHERE client_workspace_id = ${workspaceId}
      AND org_id = ${ctx.orgId}
      AND status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  const rows = await sql`
    UPDATE client_users
    SET is_active = FALSE
    WHERE id = ${userId}
      AND client_workspace_id = ${workspaceId}
    RETURNING id, name, email, is_active
  `;

  const deactivated = rows[0];
  if (!deactivated) throw new NotFoundError('Client user not found');

  // Audit
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (${ctx.orgId}, ${ctx.userId}, 'deactivate', 'client_user', ${userId},
            ${JSON.stringify({ is_active: false })}, NOW())
  `;

  logger.info('Client user deactivated', { clientUserId: userId });

  return new Response(JSON.stringify({
    success: true,
    data: deactivated,
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// =============================================
// SITE ACCESS MANAGEMENT
// =============================================

/**
 * POST /api/v1/client-workspaces/:id/sites
 * Grant site access to a client workspace.
 * RBAC: manager+
 */
export const grantSiteAccess: RouteHandler = async (request, params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const logger = Logger.fromContext(ctx);
  const workspaceId = params['id'];
  if (!workspaceId) throw new BadRequestError('Missing workspace ID');

  // Verify ownership
  const providerRows = await sql`
    SELECT id FROM client_workspace_providers
    WHERE client_workspace_id = ${workspaceId}
      AND org_id = ${ctx.orgId}
      AND status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  const body = await request.json() as Record<string, unknown>;
  const siteId = validateRequiredString(body['site_id'] as string | undefined, 'site_id', 100);
  const accessLevel = (body['access_level'] as string) ?? 'full';

  if (!['full', 'restricted'].includes(accessLevel)) {
    throw new BadRequestError('Invalid access_level. Must be: full, restricted');
  }

  // Verify site belongs to inspector's org
  const siteRows = await sql`
    SELECT id, name FROM sites WHERE id = ${siteId} AND org_id = ${ctx.orgId} LIMIT 1
  `;
  if (siteRows.length === 0) {
    throw new NotFoundError('Site not found in your organisation');
  }

  // Grant access (upsert)
  const rows = await sql`
    INSERT INTO client_site_access (client_workspace_id, site_id, access_level, granted_by)
    VALUES (${workspaceId}, ${siteId}, ${accessLevel}, ${ctx.userId})
    ON CONFLICT (client_workspace_id, site_id) DO UPDATE
    SET access_level = ${accessLevel}, granted_by = ${ctx.userId}, granted_at = NOW()
    RETURNING id, client_workspace_id, site_id, access_level, granted_at
  `;

  const access = rows[0];

  // Audit
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (${ctx.orgId}, ${ctx.userId}, 'grant_access', 'client_site_access', ${access?.['id'] as string ?? ''},
            ${JSON.stringify({ site_id: siteId, workspace_id: workspaceId, access_level: accessLevel })}, NOW())
  `;

  logger.info('Site access granted', { workspaceId, siteId });

  return new Response(JSON.stringify({
    success: true,
    data: access,
    requestId: ctx.requestId,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * GET /api/v1/client-workspaces/:id/sites
 * List all sites granted to a client workspace.
 * RBAC: manager+
 */
export const listGrantedSites: RouteHandler = async (_request, params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const workspaceId = params['id'];
  if (!workspaceId) throw new BadRequestError('Missing workspace ID');

  // Verify ownership
  const providerRows = await sql`
    SELECT id FROM client_workspace_providers
    WHERE client_workspace_id = ${workspaceId}
      AND org_id = ${ctx.orgId}
      AND status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  const rows = await sql`
    SELECT
      csa.id, csa.site_id, csa.access_level, csa.granted_by, csa.granted_at,
      s.name AS site_name, s.postcode, s.status AS site_status,
      (SELECT COUNT(*) FROM assets a WHERE a.site_id = s.id)::INTEGER AS asset_count
    FROM client_site_access csa
    INNER JOIN sites s ON s.id = csa.site_id
    WHERE csa.client_workspace_id = ${workspaceId}
    ORDER BY s.name ASC
  `;

  return new Response(JSON.stringify({
    success: true,
    data: rows,
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * DELETE /api/v1/client-workspaces/:id/sites/:siteId
 * Revoke site access from a client workspace.
 * RBAC: manager+
 */
export const revokeSiteAccess: RouteHandler = async (_request, params, ctx) => {
  requireRole(ctx, 'manager');
  const sql = neon(ctx.env.DATABASE_URL);
  const logger = Logger.fromContext(ctx);
  const workspaceId = params['id'];
  const siteId = params['siteId'];
  if (!workspaceId || !siteId) throw new BadRequestError('Missing workspace or site ID');

  // Verify ownership
  const providerRows = await sql`
    SELECT id FROM client_workspace_providers
    WHERE client_workspace_id = ${workspaceId}
      AND org_id = ${ctx.orgId}
      AND status = 'active'
    LIMIT 1
  `;
  if (providerRows.length === 0) {
    throw new NotFoundError('Client workspace not found');
  }

  const rows = await sql`
    DELETE FROM client_site_access
    WHERE client_workspace_id = ${workspaceId}
      AND site_id = ${siteId}
    RETURNING id
  `;

  if (rows.length === 0) {
    throw new NotFoundError('Site access not found');
  }

  // Audit
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (${ctx.orgId}, ${ctx.userId}, 'revoke_access', 'client_site_access', ${rows[0]?.['id'] as string ?? ''},
            ${JSON.stringify({ site_id: siteId, workspace_id: workspaceId })}, NOW())
  `;

  logger.info('Site access revoked', { workspaceId, siteId });

  return new Response(JSON.stringify({
    success: true,
    data: { revoked: true },
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// =============================================
// VERIFICATION QUEUE (Inspector-side)
// =============================================

/**
 * GET /api/v1/client-updates/pending
 * List unverified client defect updates across all client workspaces
 * linked to the inspector's org. Sorted by most recent first.
 * RBAC: inspector+ (inspectors verify their own work)
 */
export const listPendingClientUpdates: RouteHandler = async (request, _params, ctx) => {
  const sql = neon(ctx.env.DATABASE_URL);
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 50);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const rows = await sql`
    SELECT
      cdu.id, cdu.defect_id, cdu.update_type, cdu.comment, cdu.attachments,
      cdu.proposed_status, cdu.created_at,
      cu.name AS client_user_name, cu.email AS client_user_email,
      cw.name AS workspace_name,
      d.description AS defect_description, d.severity AS defect_severity,
      d.status AS defect_status,
      s.name AS site_name,
      a.asset_code
    FROM client_defect_updates cdu
    INNER JOIN client_users cu ON cu.id = cdu.client_user_id
    INNER JOIN client_workspaces cw ON cw.id = cdu.client_workspace_id
    INNER JOIN client_workspace_providers cwp
      ON cwp.client_workspace_id = cw.id
      AND cwp.org_id = ${ctx.orgId}
      AND cwp.status = 'active'
    INNER JOIN defects d ON d.id = cdu.defect_id
    LEFT JOIN sites s ON s.id = d.site_id
    LEFT JOIN assets a ON a.id = d.asset_id
    WHERE cdu.inspector_verified = FALSE
    ORDER BY
      CASE cdu.update_type
        WHEN 'work_complete' THEN 1
        WHEN 'unable_to_action' THEN 2
        WHEN 'contractor_booked' THEN 3
        WHEN 'acknowledged' THEN 4
        WHEN 'comment' THEN 5
      END,
      cdu.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  // Get total count for pagination
  const countRows = await sql`
    SELECT COUNT(*)::INTEGER AS total
    FROM client_defect_updates cdu
    INNER JOIN client_workspace_providers cwp
      ON cwp.client_workspace_id = cdu.client_workspace_id
      AND cwp.org_id = ${ctx.orgId}
      AND cwp.status = 'active'
    WHERE cdu.inspector_verified = FALSE
  `;

  const total = (countRows[0] as { total: number } | undefined)?.total ?? 0;

  return new Response(JSON.stringify({
    success: true,
    data: rows,
    pagination: { total, limit, offset },
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * PUT /api/v1/client-updates/:id/verify
 * Verify (accept or reject) a client defect update.
 * RBAC: inspector+
 *
 * Body: { verified: boolean, inspector_notes?: string }
 */
export const verifyClientUpdate: RouteHandler = async (request, params, ctx) => {
  const sql = neon(ctx.env.DATABASE_URL);
  const logger = Logger.fromContext(ctx);
  const updateId = params['id'];
  if (!updateId) throw new BadRequestError('Missing update ID');

  const body = await request.json() as Record<string, unknown>;

  if (typeof body['verified'] !== 'boolean') {
    throw new BadRequestError('verified must be a boolean');
  }

  const verified = body['verified'] as boolean;
  const inspectorNotes = validateOptionalString(body['inspector_notes'] as string | undefined, 'inspector_notes', 2000);

  // Verify the update belongs to a workspace linked to inspector's org
  const checkRows = await sql`
    SELECT cdu.id, cdu.defect_id, cdu.update_type, cdu.proposed_status,
           cdu.inspector_verified
    FROM client_defect_updates cdu
    INNER JOIN client_workspace_providers cwp
      ON cwp.client_workspace_id = cdu.client_workspace_id
      AND cwp.org_id = ${ctx.orgId}
      AND cwp.status = 'active'
    WHERE cdu.id = ${updateId}
    LIMIT 1
  `;

  const existing = checkRows[0] as {
    id: string;
    defect_id: string;
    update_type: string;
    proposed_status: string | null;
    inspector_verified: boolean;
  } | undefined;

  if (!existing) {
    throw new NotFoundError('Client update not found');
  }

  if (existing.inspector_verified) {
    throw new ConflictError('This client update has already been verified');
  }

  // Mark as verified
  const rows = await sql`
    UPDATE client_defect_updates
    SET
      inspector_verified = TRUE,
      inspector_verified_by = ${ctx.userId},
      inspector_verified_at = NOW(),
      inspector_notes = ${inspectorNotes}
    WHERE id = ${updateId}
    RETURNING id, defect_id, update_type, proposed_status, inspector_verified,
              inspector_verified_by, inspector_verified_at, inspector_notes
  `;

  const result = rows[0];

  // If verified=true AND update_type is 'work_complete', log but do NOT change
  // the canonical defect status. The inspector must separately update the defect
  // to 'verified' via the normal defect update endpoint. This maintains separation
  // of duties: client asserts, inspector verifies.
  //
  // If verified=false, it's a rejection — no status change needed.

  // Audit
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (${ctx.orgId}, ${ctx.userId}, 'verify_client_update', 'client_defect_update', ${updateId},
            ${JSON.stringify({ verified, inspector_notes: inspectorNotes, defect_id: existing.defect_id })}, NOW())
  `;

  logger.info('Client update verified', { updateId, verified, defectId: existing.defect_id });

  return new Response(JSON.stringify({
    success: true,
    data: result,
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
