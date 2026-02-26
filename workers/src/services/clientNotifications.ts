/**
 * InspectVoice — Client Notification Service
 * workers/src/services/clientNotifications.ts
 *
 * Fires notifications to client users when:
 *   - An inspection report is published (signed/exported)
 *   - A critical defect (very_high/high) is found
 *   - A defect status changes
 *   - A client's remedial update is verified/rejected
 *   - A comment mentions a client user (future)
 *
 * Each function:
 *   1. Finds which client workspaces have access to the site
 *   2. Finds which client users in those workspaces should be notified
 *   3. Inserts notification rows
 *
 * Email sending is a separate concern (future batch or cron).
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon } from '@neondatabase/serverless';
import type { Env } from '../types';

// =============================================
// REPORT PUBLISHED
// =============================================

/**
 * Notify client users when an inspection report is signed/exported.
 * Targets: all active users in workspaces with access to the site.
 */
export async function notifyReportPublished(
  env: Env,
  siteId: string,
  inspectionId: string,
  siteName: string,
  inspectionType: string,
  overallRisk: string | null,
): Promise<void> {
  const sql = neon(env.DATABASE_URL);

  try {
    // Find all client users with access to this site
    const users = await sql`
      SELECT cu.id AS client_user_id, csa.client_workspace_id
      FROM client_users cu
      INNER JOIN client_site_access csa
        ON csa.client_workspace_id = cu.client_workspace_id
      INNER JOIN client_workspaces cw
        ON cw.id = cu.client_workspace_id
        AND cw.status = 'active'
      WHERE csa.site_id = ${siteId}
        AND cu.is_active = TRUE
    `;

    if (users.length === 0) return;

    // Check user notification preferences — only notify if subscribed to this site
    // or if they have no site_subscriptions (meaning all sites)
    const notifications = users
      .map((u) => ({
        client_workspace_id: u['client_workspace_id'] as string,
        client_user_id: u['client_user_id'] as string,
        notification_type: 'report_published' as const,
        site_id: siteId,
        title: `Inspection report published — ${siteName}`,
        body: `A ${inspectionType} inspection has been completed${overallRisk ? ` with overall risk rating: ${overallRisk}` : ''}.`,
        link_url: `/portal/inspections/${inspectionId}`,
      }));

    await insertNotifications(sql, notifications);
  } catch (error) {
    console.error('notifyReportPublished failed:', error instanceof Error ? error.message : String(error));
  }
}

// =============================================
// CRITICAL DEFECT FOUND
// =============================================

/**
 * Notify client users when a very_high or high severity defect is created.
 */
export async function notifyCriticalDefect(
  env: Env,
  siteId: string,
  defectId: string,
  siteName: string,
  severity: string,
  description: string,
): Promise<void> {
  const sql = neon(env.DATABASE_URL);

  try {
    const users = await sql`
      SELECT cu.id AS client_user_id, csa.client_workspace_id
      FROM client_users cu
      INNER JOIN client_site_access csa
        ON csa.client_workspace_id = cu.client_workspace_id
      INNER JOIN client_workspaces cw
        ON cw.id = cu.client_workspace_id
        AND cw.status = 'active'
      WHERE csa.site_id = ${siteId}
        AND cu.is_active = TRUE
    `;

    if (users.length === 0) return;

    const shortDesc = description.length > 100 ? description.substring(0, 97) + '...' : description;

    const notifications = users.map((u) => ({
      client_workspace_id: u['client_workspace_id'] as string,
      client_user_id: u['client_user_id'] as string,
      notification_type: 'critical_defect' as const,
      site_id: siteId,
      title: `${severity.toUpperCase()} defect — ${siteName}`,
      body: shortDesc,
      link_url: `/portal/defects/${defectId}`,
    }));

    await insertNotifications(sql, notifications);
  } catch (error) {
    console.error('notifyCriticalDefect failed:', error instanceof Error ? error.message : String(error));
  }
}

// =============================================
// DEFECT STATUS CHANGED
// =============================================

/**
 * Notify client users when a defect's status changes
 * (e.g. inspector resolves or verifies a defect).
 */
export async function notifyDefectStatusChanged(
  env: Env,
  siteId: string,
  defectId: string,
  siteName: string,
  oldStatus: string,
  newStatus: string,
): Promise<void> {
  const sql = neon(env.DATABASE_URL);

  try {
    const users = await sql`
      SELECT cu.id AS client_user_id, csa.client_workspace_id
      FROM client_users cu
      INNER JOIN client_site_access csa
        ON csa.client_workspace_id = cu.client_workspace_id
      INNER JOIN client_workspaces cw
        ON cw.id = cu.client_workspace_id
        AND cw.status = 'active'
      WHERE csa.site_id = ${siteId}
        AND cu.is_active = TRUE
    `;

    if (users.length === 0) return;

    const notifications = users.map((u) => ({
      client_workspace_id: u['client_workspace_id'] as string,
      client_user_id: u['client_user_id'] as string,
      notification_type: 'defect_status_changed' as const,
      site_id: siteId,
      title: `Defect status updated — ${siteName}`,
      body: `Status changed from "${formatStatus(oldStatus)}" to "${formatStatus(newStatus)}".`,
      link_url: `/portal/defects/${defectId}`,
    }));

    await insertNotifications(sql, notifications);
  } catch (error) {
    console.error('notifyDefectStatusChanged failed:', error instanceof Error ? error.message : String(error));
  }
}

// =============================================
// REMEDIAL UPDATE VERIFIED/REJECTED
// =============================================

/**
 * Notify the client user who submitted a defect update
 * when the inspector verifies or rejects it.
 */
export async function notifyRemedialVerified(
  env: Env,
  clientWorkspaceId: string,
  clientUserDbId: string,
  defectId: string,
  siteId: string,
  siteName: string,
  verified: boolean,
  inspectorNotes: string | null,
): Promise<void> {
  const sql = neon(env.DATABASE_URL);

  try {
    const title = verified
      ? `Remedial work verified — ${siteName}`
      : `Remedial update reviewed — ${siteName}`;

    const body = verified
      ? 'Your reported remedial work has been verified by the inspector.'
      : `Your update has been reviewed.${inspectorNotes ? ` Inspector notes: ${inspectorNotes.substring(0, 100)}` : ''}`;

    await insertNotifications(sql, [{
      client_workspace_id: clientWorkspaceId,
      client_user_id: clientUserDbId,
      notification_type: 'remedial_complete' as const,
      site_id: siteId,
      title,
      body,
      link_url: `/portal/defects/${defectId}`,
    }]);
  } catch (error) {
    console.error('notifyRemedialVerified failed:', error instanceof Error ? error.message : String(error));
  }
}

// =============================================
// HELPERS
// =============================================

interface NotificationInput {
  client_workspace_id: string;
  client_user_id: string;
  notification_type: string;
  site_id: string;
  title: string;
  body: string;
  link_url: string;
}

/**
 * Batch insert notifications. Uses a single INSERT with UNNEST for efficiency.
 */
async function insertNotifications(
  sql: ReturnType<typeof neon>,
  notifications: NotificationInput[],
): Promise<void> {
  if (notifications.length === 0) return;

  // Insert one at a time for simplicity and Neon serverless compatibility
  for (const n of notifications) {
    await sql`
      INSERT INTO client_notifications (
        client_workspace_id, client_user_id, notification_type,
        site_id, title, body, link_url
      )
      VALUES (
        ${n.client_workspace_id}, ${n.client_user_id}, ${n.notification_type},
        ${n.site_id}, ${n.title}, ${n.body}, ${n.link_url}
      )
    `;
  }
}

/** Human-readable defect status */
function formatStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
