/**
 * Feature 10: Public Verification Endpoint
 * workers/src/routes/verify.ts
 *
 * GET /api/v1/verify/:bundleId — public, no JWT, rate-limited by IP.
 * Called BEFORE the auth guard in index.ts (same pattern as webhooks).
 *
 * Bypasses RLS by using a direct Neon HTTP query (no app.current_org_id set).
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { Env, SealedExportRow } from '../types';
import { neon } from '@neondatabase/serverless';

// =============================================
// HANDLER (called directly from index.ts fetch)
// =============================================

export async function verifyBundle(request: Request, env: Env): Promise<Response> {
  // 1. Extract bundle ID
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const bundleId = parts[parts.length - 1] ?? '';

  if (!isValidUuid(bundleId)) {
    return json({ valid: false, reason: 'Invalid bundle ID format' }, 400);
  }

  // 2. Rate limit by IP (simple in-memory, per-isolate)
  const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (isRateLimited(clientIp)) {
    return json({ valid: false, reason: 'Rate limit exceeded. Try again in 1 minute.' }, 429);
  }

  // 3. Direct DB query — no RLS (public endpoint, no org context)
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      SELECT bundle_id, export_type, generated_at, file_count,
             manifest_sha256, signing_key_id
      FROM sealed_exports
      WHERE bundle_id = ${bundleId}::uuid
      LIMIT 1
    `;

    if (rows.length === 0) {
      return json({ valid: false, reason: 'Bundle not found' }, 404);
    }

    const row = rows[0]!;

    return json({
      valid: true,
      bundle_id: row.bundle_id,
      export_type: row.export_type,
      generated_at: row.generated_at,
      file_count: row.file_count,
      signature_algorithm: 'HMAC-SHA256',
      signing_key_id: row.signing_key_id,
      manifest_sha256: row.manifest_sha256,
    }, 200);
  } catch (err) {
    console.error('verifyBundle error:', err);
    return json({ valid: false, reason: 'Internal server error' }, 500);
  }
}

// =============================================
// RATE LIMITING (in-memory, per-isolate)
// =============================================

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_REQUESTS = 30;
const WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > MAX_REQUESTS;
}

// =============================================
// HELPERS
// =============================================

function isValidUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

function json(data: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
