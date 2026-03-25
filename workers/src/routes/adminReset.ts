/**
 * InspectVoice — Admin Reset Demo Data
 * DELETE /api/v1/admin/reset-demo-data
 *
 * Wipes all org data in dependency order. Admin only.
 * Used for demo preparation — gives a clean slate.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */
import type { RouteParams, RequestContext } from '../types';
import { neon } from '@neondatabase/serverless';

export async function resetDemoData(
  _request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  // Admin only
  if (!['admin', 'org:admin'].includes(ctx.userRole)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin only' },
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const sql = neon(ctx.env.DATABASE_URL);
  const orgId = ctx.orgId;

  try {
    // Delete in dependency order — children before parents
    // 1. Defect library entries
    await sql`DELETE FROM defect_library WHERE org_id = ${orgId}`;
    // 2. Normalisation history
    await sql`DELETE FROM normalisation_history WHERE org_id = ${orgId}`;
    // 3. Sealed exports
    await sql`DELETE FROM sealed_exports WHERE org_id = ${orgId}`;
    // 4. Notification log
    await sql`DELETE FROM notification_log WHERE org_id = ${orgId}`;
    // 5. Make-safe actions (references defects)
    await sql`DELETE FROM make_safe_actions WHERE org_id = ${orgId}`;
    // 6. Incidents
    await sql`DELETE FROM incidents WHERE org_id = ${orgId}`;
    // 7. Defects (references inspection_items)
    await sql`DELETE FROM defects WHERE org_id = ${orgId}`;
    // 8. Inspection items (references inspections + assets)
    await sql`DELETE FROM inspection_items WHERE org_id = ${orgId}`;
    // 9. Inspections (references sites)
    await sql`DELETE FROM inspections WHERE org_id = ${orgId}`;
    // 10. Inspector metrics
    await sql`DELETE FROM inspector_metrics_period WHERE org_id = ${orgId}`;
    // 11. Assets (references sites)
    await sql`DELETE FROM assets WHERE org_id = ${orgId}`;
    // 12. Sites
    await sql`DELETE FROM sites WHERE org_id = ${orgId}`;

    return new Response(
      JSON.stringify({
        success: true,
        message: 'All demo data cleared for organisation',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
