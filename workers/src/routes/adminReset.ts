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
  // Resolve Clerk org ID → database UUID (only needed for uuid-typed columns)
  const orgRows = await sql`SELECT id FROM organisations WHERE org_id = ${orgId}`;
  const dbOrgId = orgRows[0]?.id as string | undefined;
  if (!dbOrgId) {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Organisation not found' } }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  await sql`DELETE FROM defect_library_entry_version WHERE entry_id IN (SELECT id FROM defect_library_entry WHERE org_id = ${orgId})`;
  await sql`DELETE FROM defect_library_entry WHERE org_id = ${orgId}`;
  await sql`DELETE FROM defect_field_audit WHERE org_id = ${orgId}`;
  await sql`DELETE FROM normalisation_log WHERE org_id = ${orgId}`;
  await sql`DELETE FROM normalisation_usage WHERE org_id = ${orgId}`;
  await sql`DELETE FROM sealed_exports WHERE org_id = ${dbOrgId}`;
  await sql`DELETE FROM notification_log WHERE org_id = ${orgId}`;
  await sql`DELETE FROM performance_share_links WHERE org_id = ${orgId}`;
  await sql`DELETE FROM photos WHERE inspection_item_id IN (SELECT id FROM inspection_items WHERE inspection_id IN (SELECT id FROM inspections WHERE org_id = ${orgId}))`;
  await sql`DELETE FROM make_safe_actions WHERE org_id = ${orgId}`;
  await sql`DELETE FROM incidents WHERE org_id = ${dbOrgId}`;
  await sql`DELETE FROM defects WHERE org_id = ${orgId}`;
  await sql`DELETE FROM inspection_items WHERE inspection_id IN (SELECT id FROM inspections WHERE org_id = ${orgId})`;
  await sql`DELETE FROM inspections WHERE org_id = ${orgId}`;
  await sql`DELETE FROM inspector_metrics_period WHERE org_id = ${orgId}`;
  await sql`DELETE FROM asset_baseline_history WHERE org_id = ${orgId}`;
  await sql`DELETE FROM recall_asset_matches WHERE org_id = ${orgId}`;
  await sql`DELETE FROM site_assignments WHERE org_id = ${orgId}`;
  await sql`DELETE FROM assets WHERE org_id = ${orgId}`;
  await sql`DELETE FROM sites WHERE org_id = ${orgId}`;
  await sql`DELETE FROM audit_log WHERE org_id = ${orgId}`;

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
