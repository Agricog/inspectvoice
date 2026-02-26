/**
 * InspectVoice — Client Portal Routes
 * workers/src/routes/portal.ts
 *
 * Every endpoint here uses portalGuard (client Clerk instance).
 * Data is scoped through client_site_access — clients only see
 * sites explicitly granted to their workspace.
 *
 * Read endpoints:
 *   GET  /api/v1/portal/dashboard          → Compliance overview
 *   GET  /api/v1/portal/sites              → Sites list
 *   GET  /api/v1/portal/sites/:id          → Site detail + assets
 *   GET  /api/v1/portal/inspections        → Inspection reports
 *   GET  /api/v1/portal/inspections/:id    → Single inspection detail
 *   GET  /api/v1/portal/defects            → Defect tracker
 *   GET  /api/v1/portal/defects/:id        → Single defect detail
 *   GET  /api/v1/portal/notifications      → Notification list
 *   POST /api/v1/portal/notifications/read → Mark notifications read
 *
 * Write endpoints (contributor+):
 *   POST /api/v1/portal/defects/:id/update → Submit defect update
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon } from '@neondatabase/serverless';
import type { PortalRequestContext, RouteParams } from '../types';
import { requirePortalRole, requirePortalSiteAccess, requirePortalDefectAccess } from '../middleware/portalGuard';
import { validateRequiredString, validateOptionalString, validateEnum } from '../shared/validation';
import { BadRequestError, NotFoundError } from '../shared/errors';

// =============================================
// DASHBOARD
// =============================================

/**
 * GET /api/v1/portal/dashboard
 * Compliance overview for the client workspace.
 */
export async function portalDashboard(
  _request: Request,
  _params: RouteParams,
  ctx: PortalRequestContext,
): Promise<Response> {
  const sql = neon(ctx.env.DATABASE_URL);

  // All queries scoped through client_site_access
  const [workspaceRow, siteCount, defectStats, recentReports, pendingCount] = await Promise.all([
    // Workspace info
    sql`
      SELECT id, name, branding FROM client_workspaces WHERE id = ${ctx.clientWorkspaceId} LIMIT 1
    `,

    // Site count
    sql`
      SELECT COUNT(*)::INTEGER AS count
      FROM client_site_access
      WHERE client_workspace_id = ${ctx.clientWorkspaceId}
    `,

    // Open defect stats
    sql`
      SELECT
        COUNT(*) FILTER (WHERE d.status NOT IN ('resolved', 'verified'))::INTEGER AS total_open,
        COUNT(*) FILTER (WHERE d.severity IN ('very_high', 'high') AND d.status NOT IN ('resolved', 'verified'))::INTEGER AS critical_open
      FROM defects d
      INNER JOIN client_site_access csa
        ON csa.site_id = d.site_id
        AND csa.client_workspace_id = ${ctx.clientWorkspaceId}
    `,

    // Recent signed reports (last 10)
    sql`
      SELECT
        i.id AS inspection_id,
        s.name AS site_name,
        i.inspection_type,
        i.signed_at,
        i.overall_risk_rating,
        i.total_defects,
        i.pdf_url
      FROM inspections i
      INNER JOIN sites s ON s.id = i.site_id
      INNER JOIN client_site_access csa
        ON csa.site_id = i.site_id
        AND csa.client_workspace_id = ${ctx.clientWorkspaceId}
      WHERE i.status IN ('signed', 'exported')
      ORDER BY i.signed_at DESC
      LIMIT 10
    `,

    // Pending client updates (unverified)
    sql`
      SELECT COUNT(*)::INTEGER AS count
      FROM client_defect_updates
      WHERE client_workspace_id = ${ctx.clientWorkspaceId}
        AND inspector_verified = FALSE
    `,
  ]);

  const workspace = workspaceRow[0];
  const stats = defectStats[0] as { total_open: number; critical_open: number } | undefined;

  return new Response(JSON.stringify({
    success: true,
    data: {
      workspace: workspace ? { id: workspace['id'], name: workspace['name'], branding: workspace['branding'] } : null,
      site_count: (siteCount[0] as { count: number } | undefined)?.count ?? 0,
      total_defects_open: stats?.total_open ?? 0,
      critical_defects_open: stats?.critical_open ?? 0,
      recent_reports: recentReports,
      pending_actions: (pendingCount[0] as { count: number } | undefined)?.count ?? 0,
    },
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================
// SITES
// =============================================

/**
 * GET /api/v1/portal/sites
 * List sites the client workspace has access to.
 */
export async function portalListSites(
  _request: Request,
  _params: RouteParams,
  ctx: PortalRequestContext,
): Promise<Response> {
  const sql = neon(ctx.env.DATABASE_URL);

  const rows = await sql`
    SELECT
      s.id, s.name, s.site_code, s.address, s.postcode,
      s.site_type, s.status,
      csa.access_level,
      (SELECT COUNT(*) FROM assets a WHERE a.site_id = s.id)::INTEGER AS asset_count,
      (SELECT COUNT(*) FROM defects d WHERE d.site_id = s.id AND d.status NOT IN ('resolved', 'verified'))::INTEGER AS open_defects,
      (SELECT MAX(i.signed_at) FROM inspections i WHERE i.site_id = s.id AND i.status IN ('signed', 'exported')) AS last_inspection_date
    FROM sites s
    INNER JOIN client_site_access csa
      ON csa.site_id = s.id
      AND csa.client_workspace_id = ${ctx.clientWorkspaceId}
    ORDER BY s.name ASC
  `;

  return new Response(JSON.stringify({
    success: true,
    data: rows,
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/v1/portal/sites/:id
 * Site detail with assets.
 */
export async function portalGetSite(
  _request: Request,
  params: RouteParams,
  ctx: PortalRequestContext,
): Promise<Response> {
  const siteId = params['id'];
  if (!siteId) throw new BadRequestError('Missing site ID');

  await requirePortalSiteAccess(ctx, siteId);

  const sql = neon(ctx.env.DATABASE_URL);

  const [siteRows, assets, recentInspections] = await Promise.all([
    sql`
      SELECT id, name, site_code, address, postcode, site_type, status,
             contact_name, contact_phone, contact_email,
             lat, lng, opening_hours, access_notes
      FROM sites
      WHERE id = ${siteId}
      LIMIT 1
    `,

    sql`
      SELECT id, asset_code, asset_type, asset_category, manufacturer_name,
             model, install_date, last_inspection_date, last_inspection_condition,
             condition_trend
      FROM assets
      WHERE site_id = ${siteId}
      ORDER BY asset_code ASC
    `,

    sql`
      SELECT id, inspection_type, status, signed_at, overall_risk_rating,
             total_defects, pdf_url
      FROM inspections
      WHERE site_id = ${siteId}
        AND status IN ('signed', 'exported')
      ORDER BY signed_at DESC
      LIMIT 20
    `,
  ]);

  const site = siteRows[0];
  if (!site) throw new NotFoundError('Site not found');

  return new Response(JSON.stringify({
    success: true,
    data: {
      ...site,
      assets,
      recent_inspections: recentInspections,
    },
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================
// INSPECTIONS
// =============================================

/**
 * GET /api/v1/portal/inspections
 * List signed inspection reports across all granted sites.
 */
export async function portalListInspections(
  request: Request,
  _params: RouteParams,
  ctx: PortalRequestContext,
): Promise<Response> {
  const sql = neon(ctx.env.DATABASE_URL);
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 50);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const siteId = url.searchParams.get('site_id');

  let rows;
  let countRows;

  if (siteId) {
    await requirePortalSiteAccess(ctx, siteId);

    rows = await sql`
      SELECT
        i.id, i.inspection_type, i.status, i.signed_at, i.signed_by,
        i.overall_risk_rating, i.total_defects,
        i.very_high_count, i.high_count, i.medium_count, i.low_count,
        i.pdf_url, i.pdf_generated_at,
        s.name AS site_name
      FROM inspections i
      INNER JOIN sites s ON s.id = i.site_id
      WHERE i.site_id = ${siteId}
        AND i.status IN ('signed', 'exported')
      ORDER BY i.signed_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    countRows = await sql`
      SELECT COUNT(*)::INTEGER AS total
      FROM inspections
      WHERE site_id = ${siteId}
        AND status IN ('signed', 'exported')
    `;
  } else {
    rows = await sql`
      SELECT
        i.id, i.inspection_type, i.status, i.signed_at, i.signed_by,
        i.overall_risk_rating, i.total_defects,
        i.very_high_count, i.high_count, i.medium_count, i.low_count,
        i.pdf_url, i.pdf_generated_at,
        s.name AS site_name
      FROM inspections i
      INNER JOIN sites s ON s.id = i.site_id
      INNER JOIN client_site_access csa
        ON csa.site_id = i.site_id
        AND csa.client_workspace_id = ${ctx.clientWorkspaceId}
      WHERE i.status IN ('signed', 'exported')
      ORDER BY i.signed_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    countRows = await sql`
      SELECT COUNT(*)::INTEGER AS total
      FROM inspections i
      INNER JOIN client_site_access csa
        ON csa.site_id = i.site_id
        AND csa.client_workspace_id = ${ctx.clientWorkspaceId}
      WHERE i.status IN ('signed', 'exported')
    `;
  }

  const total = (countRows[0] as { total: number } | undefined)?.total ?? 0;

  return new Response(JSON.stringify({
    success: true,
    data: rows,
    pagination: { total, limit, offset },
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/v1/portal/inspections/:id
 * Single inspection detail (only if site is granted).
 */
export async function portalGetInspection(
  _request: Request,
  params: RouteParams,
  ctx: PortalRequestContext,
): Promise<Response> {
  const inspectionId = params['id'];
  if (!inspectionId) throw new BadRequestError('Missing inspection ID');

  const sql = neon(ctx.env.DATABASE_URL);

  // Get inspection + verify site access in one query
  const rows = await sql`
    SELECT
      i.id, i.inspection_type, i.status, i.signed_at, i.signed_by,
      i.overall_risk_rating, i.total_defects,
      i.very_high_count, i.high_count, i.medium_count, i.low_count,
      i.closure_recommended, i.closure_reason, i.immediate_action_required,
      i.pdf_url, i.pdf_generated_at,
      s.name AS site_name, s.id AS site_id
    FROM inspections i
    INNER JOIN sites s ON s.id = i.site_id
    INNER JOIN client_site_access csa
      ON csa.site_id = i.site_id
      AND csa.client_workspace_id = ${ctx.clientWorkspaceId}
    WHERE i.id = ${inspectionId}
      AND i.status IN ('signed', 'exported')
    LIMIT 1
  `;

  const inspection = rows[0];
  if (!inspection) throw new NotFoundError('Inspection not found');

  // Get inspection items
  const items = await sql`
    SELECT
      ii.id, ii.overall_condition, ii.risk_rating, ii.requires_action,
      ii.action_timeframe, ii.voice_transcript, ii.inspector_notes,
      a.asset_code, a.asset_type
    FROM inspection_items ii
    INNER JOIN assets a ON a.id = ii.asset_id
    WHERE ii.inspection_id = ${inspectionId}
    ORDER BY a.asset_code ASC
  `;

  // Get defects for this inspection
  const defects = await sql`
    SELECT
      d.id, d.description, d.severity, d.status, d.bs_en_reference,
      d.defect_category, d.estimated_cost_gbp, d.due_date,
      a.asset_code
    FROM defects d
    INNER JOIN inspection_items ii ON ii.id = d.inspection_item_id
    LEFT JOIN assets a ON a.id = d.asset_id
    WHERE ii.inspection_id = ${inspectionId}
    ORDER BY
      CASE d.severity
        WHEN 'very_high' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END
  `;

  return new Response(JSON.stringify({
    success: true,
    data: {
      ...inspection,
      items,
      defects,
    },
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================
// DEFECTS
// =============================================

/**
 * GET /api/v1/portal/defects
 * Defect tracker — all open/active defects across granted sites.
 */
export async function portalListDefects(
  request: Request,
  _params: RouteParams,
  ctx: PortalRequestContext,
): Promise<Response> {
  const sql = neon(ctx.env.DATABASE_URL);
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 50);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const severity = url.searchParams.get('severity');
  const status = url.searchParams.get('status');
  const siteId = url.searchParams.get('site_id');

  if (siteId) {
    await requirePortalSiteAccess(ctx, siteId);
  }

  // Build query with optional filters
  const rows = await sql`
    SELECT
      d.id, d.description, d.severity, d.status, d.bs_en_reference,
      d.defect_category, d.estimated_cost_gbp, d.due_date,
      d.created_at, d.resolved_at,
      s.name AS site_name, s.id AS site_id,
      a.asset_code, a.asset_type,
      (
        SELECT cdu.proposed_status
        FROM client_defect_updates cdu
        WHERE cdu.defect_id = d.id
          AND cdu.client_workspace_id = ${ctx.clientWorkspaceId}
        ORDER BY cdu.created_at DESC
        LIMIT 1
      ) AS client_latest_status,
      (
        SELECT cdu.inspector_verified
        FROM client_defect_updates cdu
        WHERE cdu.defect_id = d.id
          AND cdu.client_workspace_id = ${ctx.clientWorkspaceId}
        ORDER BY cdu.created_at DESC
        LIMIT 1
      ) AS client_latest_verified
    FROM defects d
    INNER JOIN client_site_access csa
      ON csa.site_id = d.site_id
      AND csa.client_workspace_id = ${ctx.clientWorkspaceId}
    LEFT JOIN sites s ON s.id = d.site_id
    LEFT JOIN assets a ON a.id = d.asset_id
    WHERE 1=1
      AND (${siteId}::UUID IS NULL OR d.site_id = ${siteId})
      AND (${severity}::TEXT IS NULL OR d.severity = ${severity})
      AND (${status}::TEXT IS NULL OR d.status = ${status})
    ORDER BY
      CASE d.severity
        WHEN 'very_high' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      d.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countRows = await sql`
    SELECT COUNT(*)::INTEGER AS total
    FROM defects d
    INNER JOIN client_site_access csa
      ON csa.site_id = d.site_id
      AND csa.client_workspace_id = ${ctx.clientWorkspaceId}
    WHERE 1=1
      AND (${siteId}::UUID IS NULL OR d.site_id = ${siteId})
      AND (${severity}::TEXT IS NULL OR d.severity = ${severity})
      AND (${status}::TEXT IS NULL OR d.status = ${status})
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
}

/**
 * GET /api/v1/portal/defects/:id
 * Single defect detail with client update history.
 */
export async function portalGetDefect(
  _request: Request,
  params: RouteParams,
  ctx: PortalRequestContext,
): Promise<Response> {
  const defectId = params['id'];
  if (!defectId) throw new BadRequestError('Missing defect ID');

  await requirePortalDefectAccess(ctx, defectId);

  const sql = neon(ctx.env.DATABASE_URL);

  const [defectRows, updates] = await Promise.all([
    sql`
      SELECT
        d.id, d.description, d.severity, d.status, d.bs_en_reference,
        d.defect_category, d.source, d.estimated_cost_gbp, d.actual_cost_gbp,
        d.due_date, d.assigned_to, d.assigned_at,
        d.resolution_notes, d.resolved_at, d.verified_at,
        d.created_at,
        s.name AS site_name,
        a.asset_code, a.asset_type
      FROM defects d
      LEFT JOIN sites s ON s.id = d.site_id
      LEFT JOIN assets a ON a.id = d.asset_id
      WHERE d.id = ${defectId}
      LIMIT 1
    `,

    // Client update history for this defect
    sql`
      SELECT
        cdu.id, cdu.update_type, cdu.comment, cdu.attachments,
        cdu.proposed_status, cdu.inspector_verified,
        cdu.inspector_verified_at, cdu.inspector_notes,
        cdu.created_at,
        cu.name AS client_user_name
      FROM client_defect_updates cdu
      INNER JOIN client_users cu ON cu.id = cdu.client_user_id
      WHERE cdu.defect_id = ${defectId}
        AND cdu.client_workspace_id = ${ctx.clientWorkspaceId}
      ORDER BY cdu.created_at DESC
    `,
  ]);

  const defect = defectRows[0];
  if (!defect) throw new NotFoundError('Defect not found');

  return new Response(JSON.stringify({
    success: true,
    data: {
      ...defect,
      client_updates: updates,
    },
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================
// DEFECT UPDATES (contributor+)
// =============================================

/**
 * POST /api/v1/portal/defects/:id/update
 * Submit a client defect update (acknowledge, comment, work complete, etc).
 * RBAC: contributor+
 */
export async function portalCreateDefectUpdate(
  request: Request,
  params: RouteParams,
  ctx: PortalRequestContext,
): Promise<Response> {
  requirePortalRole(ctx, 'contributor');

  const defectId = params['id'];
  if (!defectId) throw new BadRequestError('Missing defect ID');

  await requirePortalDefectAccess(ctx, defectId);

  const sql = neon(ctx.env.DATABASE_URL);

  const body = await request.json() as Record<string, unknown>;

  const updateType = validateEnum(
    body['update_type'],
    'update_type',
    ['acknowledged', 'comment', 'work_complete', 'contractor_booked', 'unable_to_action'] as const,
  );

  const comment = validateOptionalString(body['comment'], 'comment', { maxLength: 5000 });

  // work_complete requires a comment (DB constraint enforces this too)
  if (updateType === 'work_complete' && (!comment || comment.trim().length === 0)) {
    throw new BadRequestError('A comment explaining the work done is required for work_complete updates');
  }

  const attachments = Array.isArray(body['attachments']) ? body['attachments'] : [];

  // Map update_type to proposed_status
  let proposedStatus: string | null = null;
  if (updateType === 'work_complete') proposedStatus = 'work_complete_client_reported';
  if (updateType === 'contractor_booked') proposedStatus = 'contractor_booked';
  if (updateType === 'unable_to_action') proposedStatus = 'unable_to_action';

  const rows = await sql`
    INSERT INTO client_defect_updates (
      client_workspace_id, defect_id, client_user_id,
      update_type, comment, attachments, proposed_status
    )
    VALUES (
      ${ctx.clientWorkspaceId}, ${defectId}, ${ctx.clientUserDbId},
      ${updateType}, ${comment}, ${JSON.stringify(attachments)}::jsonb, ${proposedStatus}
    )
    RETURNING id, defect_id, update_type, comment, attachments, proposed_status,
              inspector_verified, created_at
  `;

  const result = rows[0];

  // Audit log — record client action with actor type
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, changes, timestamp)
    VALUES (
      (SELECT org_id FROM client_workspace_providers WHERE client_workspace_id = ${ctx.clientWorkspaceId} AND status = 'active' LIMIT 1),
      ${ctx.clientUserId},
      'client_defect_update',
      'defect',
      ${defectId},
      ${JSON.stringify({
        actor_type: 'client',
        client_workspace_id: ctx.clientWorkspaceId,
        client_user_name: ctx.clientUserName,
        update_type: updateType,
        proposed_status: proposedStatus,
      })},
      NOW()
    )
  `;

  return new Response(JSON.stringify({
    success: true,
    data: result,
    requestId: ctx.requestId,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================
// NOTIFICATIONS
// =============================================

/**
 * GET /api/v1/portal/notifications
 * List notifications for the current client user.
 */
export async function portalListNotifications(
  request: Request,
  _params: RouteParams,
  ctx: PortalRequestContext,
): Promise<Response> {
  const sql = neon(ctx.env.DATABASE_URL);
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 50);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const unreadOnly = url.searchParams.get('unread') === 'true';

  const rows = await sql`
    SELECT id, notification_type, site_id, title, body, link_url, is_read, created_at
    FROM client_notifications
    WHERE client_workspace_id = ${ctx.clientWorkspaceId}
      AND client_user_id = ${ctx.clientUserDbId}
      AND (${unreadOnly}::BOOLEAN = FALSE OR is_read = FALSE)
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countRows = await sql`
    SELECT
      COUNT(*)::INTEGER AS total,
      COUNT(*) FILTER (WHERE is_read = FALSE)::INTEGER AS unread
    FROM client_notifications
    WHERE client_workspace_id = ${ctx.clientWorkspaceId}
      AND client_user_id = ${ctx.clientUserDbId}
  `;

  const counts = countRows[0] as { total: number; unread: number } | undefined;

  return new Response(JSON.stringify({
    success: true,
    data: rows,
    pagination: { total: counts?.total ?? 0, limit, offset },
    unread_count: counts?.unread ?? 0,
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/v1/portal/notifications/read
 * Mark notifications as read. Body: { ids: string[] } or { all: true }
 */
export async function portalMarkNotificationsRead(
  request: Request,
  _params: RouteParams,
  ctx: PortalRequestContext,
): Promise<Response> {
  const sql = neon(ctx.env.DATABASE_URL);
  const body = await request.json() as Record<string, unknown>;

  if (body['all'] === true) {
    await sql`
      UPDATE client_notifications
      SET is_read = TRUE
      WHERE client_workspace_id = ${ctx.clientWorkspaceId}
        AND client_user_id = ${ctx.clientUserDbId}
        AND is_read = FALSE
    `;
  } else if (Array.isArray(body['ids']) && body['ids'].length > 0) {
    const ids = body['ids'] as string[];
    if (ids.length > 100) throw new BadRequestError('Maximum 100 notification IDs per request');

    await sql`
      UPDATE client_notifications
      SET is_read = TRUE
      WHERE client_workspace_id = ${ctx.clientWorkspaceId}
        AND client_user_id = ${ctx.clientUserDbId}
        AND id = ANY(${ids})
    `;
  } else {
    throw new BadRequestError('Provide { all: true } or { ids: [...] }');
  }

  return new Response(JSON.stringify({
    success: true,
    data: { marked_read: true },
    requestId: ctx.requestId,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
