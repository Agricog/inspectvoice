/**
 * InspectVoice — Route Planner API
 * Feature 13: Today's route planning with map + due sites.
 *
 * Endpoints:
 *   GET  /api/v1/route-planner/sites     — due/overdue sites with RBAC
 *   POST /api/v1/route-planner/optimise  — optimal stop order via Mapbox Optimization + Directions
 *
 * RBAC:
 *   org:admin / org:manager → all org sites (+ unassigned filter)
 *   org:member (inspector)  → assigned sites only
 *
 * Due date logic:
 *   For each site × inspection type (routine/operational/annual):
 *     next_due = last_inspection_date + frequency_days
 *     urgency = overdue | due_today | due_this_week | due_this_month | not_due
 *   Site-level urgency = most urgent across all types.
 *
 * Mapbox:
 *   Optimization API (≤12 stops) → optimal waypoint order
 *   Directions API (≤25 coords)  → route geometry + durations
 *   All calls server-side (token never exposed to client)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon } from '@neondatabase/serverless';
import type { Env, RequestContext, RouteParams } from '../types';
import { Logger } from '../shared/logger';
import { formatErrorResponse, AppError } from '../shared/errors';

// =============================================
// TYPES
// =============================================

type Urgency = 'overdue' | 'due_today' | 'due_this_week' | 'due_this_month' | 'not_due';

interface InspectionDue {
  inspection_type: 'routine' | 'operational' | 'annual';
  frequency_days: number;
  last_inspected: string | null;
  next_due: string | null;
  days_until_due: number | null;
  urgency: Urgency;
}

interface RoutePlannerSite {
  id: string;
  name: string;
  site_code: string | null;
  address: string;
  postcode: string | null;
  latitude: number;
  longitude: number;
  status: string;
  urgency: Urgency;
  inspection_dues: InspectionDue[];
  total_assets: number;
  open_defects: number;
  assigned_inspectors: string[];
}

interface OptimiseRequest {
  site_ids: string[];
  start_lat?: number;
  start_lng?: number;
  round_trip?: boolean;
}

interface OptimisedStop {
  site_id: string;
  order: number;
  arrival_minutes: number;
  distance_km: number;
}

interface OptimiseResponse {
  stops: OptimisedStop[];
  total_duration_minutes: number;
  total_distance_km: number;
  route_geometry: GeoJSON.Geometry | null;
}

// =============================================
// URGENCY HELPERS
// =============================================

const URGENCY_PRIORITY: Record<Urgency, number> = {
  overdue: 0,
  due_today: 1,
  due_this_week: 2,
  due_this_month: 3,
  not_due: 4,
};

function computeUrgency(daysUntilDue: number | null): Urgency {
  if (daysUntilDue === null) return 'not_due';
  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue === 0) return 'due_today';
  if (daysUntilDue <= 7) return 'due_this_week';
  if (daysUntilDue <= 30) return 'due_this_month';
  return 'not_due';
}

function mostUrgent(dues: InspectionDue[]): Urgency {
  let best: Urgency = 'not_due';
  for (const d of dues) {
    if (URGENCY_PRIORITY[d.urgency] < URGENCY_PRIORITY[best]) {
      best = d.urgency;
    }
  }
  return best;
}

// =============================================
// GET /api/v1/route-planner/sites
// =============================================

export async function getRoutePlannerSites(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  const logger = Logger.fromContext(ctx);
  const sql = neon(ctx.env.DATABASE_URL);

  try {
    const url = new URL(request.url);
    const filterUrgency = url.searchParams.get('urgency'); // overdue | due_today | due_this_week | due_this_month | all
    const filterUnassigned = url.searchParams.get('unassigned') === 'true';
    const isPrivileged = ctx.userRole === 'org:admin' || ctx.userRole === 'org:manager';

    // ── RBAC: site access ──
    let siteQuery: string;
    const queryParams: (string | boolean)[] = [ctx.orgId];

    if (isPrivileged) {
      if (filterUnassigned) {
        // Admin: sites with no active assignments
        siteQuery = `
          SELECT s.*
          FROM sites s
          LEFT JOIN site_assignments sa
            ON sa.site_id = s.id AND sa.is_active = true
          WHERE s.org_id = $1
            AND s.status = 'active'
            AND sa.id IS NULL
          ORDER BY s.name
        `;
      } else {
        // Admin: all org sites
        siteQuery = `
          SELECT s.*
          FROM sites s
          WHERE s.org_id = $1
            AND s.status = 'active'
          ORDER BY s.name
        `;
      }
    } else {
      // Inspector: assigned sites only
      siteQuery = `
        SELECT s.*
        FROM sites s
        INNER JOIN site_assignments sa
          ON sa.site_id = s.id
          AND sa.user_id = $2
          AND sa.is_active = true
        WHERE s.org_id = $1
          AND s.status = 'active'
        ORDER BY s.name
      `;
      queryParams.push(ctx.userId);
    }

    // ── Parallel queries ──
    const [sites, lastInspections, assetCounts, defectCounts, assignments] = await Promise.all([
      // 1. Sites (RBAC-filtered)
      sql(siteQuery, queryParams),

      // 2. Last inspection per site per type
      sql(`
        SELECT DISTINCT ON (i.site_id, i.inspection_type)
          i.site_id,
          i.inspection_type,
          i.inspection_date
        FROM inspections i
        WHERE i.org_id = $1
          AND i.status IN ('signed', 'completed')
        ORDER BY i.site_id, i.inspection_type, i.inspection_date DESC
      `, [ctx.orgId]),

      // 3. Asset count per site
      sql(`
        SELECT a.site_id, COUNT(*)::int AS total
        FROM assets a
        INNER JOIN sites s ON s.id = a.site_id
        WHERE s.org_id = $1
          AND a.is_active = true
        GROUP BY a.site_id
      `, [ctx.orgId]),

      // 4. Open defect count per site
      sql(`
        SELECT d.site_id, COUNT(*)::int AS total
        FROM defects d
        WHERE d.org_id = $1
          AND d.status NOT IN ('resolved', 'verified')
        GROUP BY d.site_id
      `, [ctx.orgId]),

      // 5. Assigned inspectors per site (for admin view)
      isPrivileged
        ? sql(`
            SELECT sa.site_id, array_agg(sa.user_id) AS user_ids
            FROM site_assignments sa
            WHERE sa.org_id = $1
              AND sa.is_active = true
            GROUP BY sa.site_id
          `, [ctx.orgId])
        : Promise.resolve([]),
    ]);

    // ── Build lookup maps ──
    const lastInspMap = new Map<string, Map<string, string>>();
    for (const row of lastInspections) {
      const siteId = row.site_id as string;
      const inspType = row.inspection_type as string;
      const inspDate = row.inspection_date as string;
      if (!lastInspMap.has(siteId)) lastInspMap.set(siteId, new Map());
      lastInspMap.get(siteId)!.set(inspType, inspDate);
    }

    const assetCountMap = new Map<string, number>();
    for (const row of assetCounts) {
      assetCountMap.set(row.site_id as string, row.total as number);
    }

    const defectCountMap = new Map<string, number>();
    for (const row of defectCounts) {
      defectCountMap.set(row.site_id as string, row.total as number);
    }

    const assignmentMap = new Map<string, string[]>();
    for (const row of assignments) {
      assignmentMap.set(row.site_id as string, row.user_ids as string[]);
    }

    // ── Compute due dates per site ──
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result: RoutePlannerSite[] = [];

    for (const site of sites) {
      const siteId = site.id as string;
      const siteInspections = lastInspMap.get(siteId) ?? new Map<string, string>();

      const inspectionDues: InspectionDue[] = [];

      // Routine
      const routineFreq = (site.inspection_frequency_routine_days as number) || 0;
      if (routineFreq > 0) {
        inspectionDues.push(
          computeDue('routine', routineFreq, siteInspections.get('routine') ?? null, today),
        );
      }

      // Operational
      const operationalFreq = (site.inspection_frequency_operational_days as number) || 0;
      if (operationalFreq > 0) {
        inspectionDues.push(
          computeDue('operational', operationalFreq, siteInspections.get('operational') ?? null, today),
        );
      }

      // Annual
      const annualFreq = (site.inspection_frequency_annual_days as number) || 0;
      if (annualFreq > 0) {
        inspectionDues.push(
          computeDue('annual', annualFreq, siteInspections.get('annual') ?? null, today),
        );
      }

      const siteUrgency = mostUrgent(inspectionDues);

      // Apply urgency filter
      if (filterUrgency && filterUrgency !== 'all') {
        if (filterUrgency === 'actionable') {
          // Show overdue + due_today + due_this_week
          if (siteUrgency === 'due_this_month' || siteUrgency === 'not_due') continue;
        } else if (siteUrgency !== filterUrgency) {
          continue;
        }
      }

      result.push({
        id: siteId,
        name: site.name as string,
        site_code: site.site_code as string | null,
        address: site.address as string,
        postcode: site.postcode as string | null,
        latitude: site.latitude as number,
        longitude: site.longitude as number,
        status: site.status as string,
        urgency: siteUrgency,
        inspection_dues: inspectionDues,
        total_assets: assetCountMap.get(siteId) ?? 0,
        open_defects: defectCountMap.get(siteId) ?? 0,
        assigned_inspectors: assignmentMap.get(siteId) ?? [],
      });
    }

    // Sort by urgency (most urgent first), then name
    result.sort((a, b) => {
      const urgencyDiff = URGENCY_PRIORITY[a.urgency] - URGENCY_PRIORITY[b.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;
      return a.name.localeCompare(b.name);
    });

    logger.info('Route planner sites loaded', {
      total: result.length,
      overdue: result.filter((s) => s.urgency === 'overdue').length,
      isPrivileged,
    });

    return new Response(
      JSON.stringify({ success: true, data: { sites: result } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    logger.error('Route planner sites failed', { error: error instanceof Error ? error.message : String(error) });
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// POST /api/v1/route-planner/optimise
// =============================================

export async function optimiseRoute(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  const logger = Logger.fromContext(ctx);
  const sql = neon(ctx.env.DATABASE_URL);

  try {
    const body = (await request.json()) as OptimiseRequest;

    // ── Validate ──
    if (!Array.isArray(body.site_ids) || body.site_ids.length < 2) {
      throw new AppError('VALIDATION_ERROR', 'At least 2 sites required for route optimisation', 400);
    }
    if (body.site_ids.length > 12) {
      throw new AppError('VALIDATION_ERROR', 'Maximum 12 stops supported by route optimisation', 400);
    }

    const mapboxToken = ctx.env.MAPBOX_ACCESS_TOKEN;
    if (!mapboxToken) {
      throw new AppError('SERVER_ERROR', 'Mapbox access token not configured', 500);
    }

    // ── Fetch site coordinates (RBAC-aware) ──
    const isPrivileged = ctx.userRole === 'org:admin' || ctx.userRole === 'org:manager';
    const placeholders = body.site_ids.map((_, i) => `$${i + 2}`).join(',');

    let coordQuery: string;
    const coordParams: string[] = [ctx.orgId, ...body.site_ids];

    if (isPrivileged) {
      coordQuery = `
        SELECT id, name, latitude, longitude
        FROM sites
        WHERE org_id = $1
          AND id IN (${placeholders})
        ORDER BY array_position(ARRAY[${placeholders}]::uuid[], id)
      `;
    } else {
      coordQuery = `
        SELECT s.id, s.name, s.latitude, s.longitude
        FROM sites s
        INNER JOIN site_assignments sa
          ON sa.site_id = s.id
          AND sa.user_id = $${body.site_ids.length + 2}
          AND sa.is_active = true
        WHERE s.org_id = $1
          AND s.id IN (${placeholders})
        ORDER BY array_position(ARRAY[${placeholders}]::uuid[], s.id)
      `;
      coordParams.push(ctx.userId);
    }

    const siteRows = await sql(coordQuery, coordParams);

    if (siteRows.length < 2) {
      throw new AppError('VALIDATION_ERROR', 'Fewer than 2 accessible sites found', 400);
    }

    // ── Build coordinates string ──
    // If start position provided, prepend it as the first waypoint
    const waypoints: Array<{ id: string | null; name: string; lat: number; lng: number }> = [];

    if (body.start_lat !== undefined && body.start_lng !== undefined) {
      waypoints.push({
        id: null,
        name: 'Current Location',
        lat: body.start_lat,
        lng: body.start_lng,
      });
    }

    for (const row of siteRows) {
      waypoints.push({
        id: row.id as string,
        name: row.name as string,
        lat: row.latitude as number,
        lng: row.longitude as number,
      });
    }

    const roundTrip = body.round_trip ?? false;
    const coordinatesStr = waypoints.map((w) => `${w.lng},${w.lat}`).join(';');

    // ── Mapbox Optimization API (≤12 stops → optimal order) ──
    const optimizationUrl = new URL(
      `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordinatesStr}`,
    );
    optimizationUrl.searchParams.set('access_token', mapboxToken);
    optimizationUrl.searchParams.set('roundtrip', String(roundTrip));
    optimizationUrl.searchParams.set('geometries', 'geojson');
    optimizationUrl.searchParams.set('overview', 'full');

    // If start point provided, fix it as source
    if (body.start_lat !== undefined && body.start_lng !== undefined) {
      optimizationUrl.searchParams.set('source', 'first');
      if (!roundTrip) {
        optimizationUrl.searchParams.set('destination', 'any');
      }
    }

    const optResponse = await fetch(optimizationUrl.toString());
    if (!optResponse.ok) {
      const errText = await optResponse.text();
      logger.error('Mapbox Optimization API error', { status: optResponse.status, body: errText });
      throw new AppError('EXTERNAL_SERVICE_ERROR', 'Route optimisation service unavailable', 502);
    }

    const optData = (await optResponse.json()) as {
      code: string;
      trips: Array<{
        geometry: GeoJSON.Geometry;
        duration: number;
        distance: number;
      }>;
      waypoints: Array<{
        waypoint_index: number;
        trips_index: number;
        name: string;
      }>;
    };

    if (optData.code !== 'Ok' || !optData.trips || optData.trips.length === 0) {
      throw new AppError('EXTERNAL_SERVICE_ERROR', `Route optimisation failed: ${optData.code}`, 502);
    }

    const trip = optData.trips[0];
    if (!trip) {
      throw new AppError('EXTERNAL_SERVICE_ERROR', 'No trip returned from optimisation', 502);
    }

    // ── Map optimised order back to site IDs ──
    const stops: OptimisedStop[] = [];
    let cumulativeMinutes = 0;
    let cumulativeKm = 0;

    // Build ordered waypoint list from optimization response
    const orderedWaypoints = optData.waypoints
      .slice()
      .sort((a, b) => a.waypoint_index - b.waypoint_index);

    for (let i = 0; i < orderedWaypoints.length; i++) {
      const wp = orderedWaypoints[i];
      if (!wp) continue;

      const originalIdx = optData.waypoints.indexOf(wp);
      const originalWaypoint = waypoints[originalIdx];
      if (!originalWaypoint) continue;

      // Skip the start position (not a site)
      if (originalWaypoint.id === null) continue;

      stops.push({
        site_id: originalWaypoint.id,
        order: stops.length + 1,
        arrival_minutes: Math.round(cumulativeMinutes),
        distance_km: Math.round(cumulativeKm * 10) / 10,
      });
    }

    const totalDurationMinutes = Math.round(trip.duration / 60);
    const totalDistanceKm = Math.round((trip.distance / 1000) * 10) / 10;

    const response: OptimiseResponse = {
      stops,
      total_duration_minutes: totalDurationMinutes,
      total_distance_km: totalDistanceKm,
      route_geometry: trip.geometry,
    };

    logger.info('Route optimised', {
      stops: stops.length,
      durationMin: totalDurationMinutes,
      distanceKm: totalDistanceKm,
    });

    return new Response(
      JSON.stringify({ success: true, data: response }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    logger.error('Route optimisation failed', { error: error instanceof Error ? error.message : String(error) });
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// POST /api/v1/route-planner/directions
// =============================================

/**
 * Get driving directions for a manually-ordered list of stops.
 * Used after drag-to-reorder — re-runs Directions only, no re-optimisation.
 * Supports ≤25 coordinates (Mapbox Directions limit).
 */
export async function getDirections(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  const logger = Logger.fromContext(ctx);

  try {
    const body = (await request.json()) as {
      coordinates: Array<{ lat: number; lng: number }>;
    };

    if (!Array.isArray(body.coordinates) || body.coordinates.length < 2) {
      throw new AppError('VALIDATION_ERROR', 'At least 2 coordinates required', 400);
    }
    if (body.coordinates.length > 25) {
      throw new AppError('VALIDATION_ERROR', 'Maximum 25 coordinates supported', 400);
    }

    const mapboxToken = ctx.env.MAPBOX_ACCESS_TOKEN;
    if (!mapboxToken) {
      throw new AppError('SERVER_ERROR', 'Mapbox access token not configured', 500);
    }

    const coordinatesStr = body.coordinates.map((c) => `${c.lng},${c.lat}`).join(';');

    const directionsUrl = new URL(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinatesStr}`,
    );
    directionsUrl.searchParams.set('access_token', mapboxToken);
    directionsUrl.searchParams.set('geometries', 'geojson');
    directionsUrl.searchParams.set('overview', 'full');
    directionsUrl.searchParams.set('steps', 'false');
    directionsUrl.searchParams.set('annotations', 'duration,distance');

    const dirResponse = await fetch(directionsUrl.toString());
    if (!dirResponse.ok) {
      const errText = await dirResponse.text();
      logger.error('Mapbox Directions API error', { status: dirResponse.status, body: errText });
      throw new AppError('EXTERNAL_SERVICE_ERROR', 'Directions service unavailable', 502);
    }

    const dirData = (await dirResponse.json()) as {
      code: string;
      routes: Array<{
        geometry: GeoJSON.Geometry;
        duration: number;
        distance: number;
        legs: Array<{
          duration: number;
          distance: number;
        }>;
      }>;
    };

    if (dirData.code !== 'Ok' || !dirData.routes || dirData.routes.length === 0) {
      throw new AppError('EXTERNAL_SERVICE_ERROR', `Directions failed: ${dirData.code}`, 502);
    }

    const route = dirData.routes[0];
    if (!route) {
      throw new AppError('EXTERNAL_SERVICE_ERROR', 'No route returned from directions', 502);
    }

    // Build per-leg data
    const legs = (route.legs ?? []).map((leg, idx) => ({
      from_index: idx,
      to_index: idx + 1,
      duration_minutes: Math.round(leg.duration / 60),
      distance_km: Math.round((leg.distance / 1000) * 10) / 10,
    }));

    logger.info('Directions fetched', {
      stops: body.coordinates.length,
      durationMin: Math.round(route.duration / 60),
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          total_duration_minutes: Math.round(route.duration / 60),
          total_distance_km: Math.round((route.distance / 1000) * 10) / 10,
          route_geometry: route.geometry,
          legs,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    logger.error('Directions failed', { error: error instanceof Error ? error.message : String(error) });
    return formatErrorResponse(error, ctx.requestId);
  }
}

// =============================================
// HELPERS
// =============================================

function computeDue(
  inspType: 'routine' | 'operational' | 'annual',
  frequencyDays: number,
  lastInspectedStr: string | null,
  today: Date,
): InspectionDue {
  if (!lastInspectedStr) {
    // Never inspected → overdue
    return {
      inspection_type: inspType,
      frequency_days: frequencyDays,
      last_inspected: null,
      next_due: null,
      days_until_due: null,
      urgency: 'overdue',
    };
  }

  const lastInspected = new Date(lastInspectedStr);
  lastInspected.setHours(0, 0, 0, 0);

  const nextDue = new Date(lastInspected);
  nextDue.setDate(nextDue.getDate() + frequencyDays);

  const diffMs = nextDue.getTime() - today.getTime();
  const daysUntilDue = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return {
    inspection_type: inspType,
    frequency_days: frequencyDays,
    last_inspected: lastInspectedStr,
    next_due: nextDue.toISOString().split('T')[0] ?? nextDue.toISOString(),
    days_until_due: daysUntilDue,
    urgency: computeUrgency(daysUntilDue),
  };
}
