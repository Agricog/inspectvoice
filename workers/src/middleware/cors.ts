/**
 * InspectVoice — CORS Middleware
 * Strict Cross-Origin Resource Sharing configuration.
 *
 * - Only allows the configured ALLOWED_ORIGIN (from env bindings)
 * - Supports credentials (cookies, auth headers)
 * - Handles preflight OPTIONS requests
 * - Rejects requests from unknown origins
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { Env } from '../types';

// =============================================
// ALLOWED METHODS & HEADERS
// =============================================

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-CSRF-Token',
  'X-Request-Id',
  'Accept',
].join(', ');

const EXPOSED_HEADERS = [
  'X-Request-Id',
  'Retry-After',
].join(', ');

/** Preflight cache duration in seconds (1 hour) */
const MAX_AGE = '3600';

// =============================================
// CORS HEADERS
// =============================================

/**
 * Build CORS headers for a response.
 * Returns empty object if origin is not allowed (response will be blocked by browser).
 */
export function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowedOrigin = env.ALLOWED_ORIGIN;

  // No origin header = same-origin request or non-browser client — allow
  if (!origin) {
    return {};
  }

  // Strict origin check — must match exactly
  if (origin !== allowedOrigin) {
    // Return empty headers — browser will block the response
    return {};
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Expose-Headers': EXPOSED_HEADERS,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': MAX_AGE,
    'Vary': 'Origin',
  };
}

// =============================================
// PREFLIGHT HANDLER
// =============================================

/**
 * Handle OPTIONS preflight requests.
 * Returns 204 No Content with CORS headers if origin is allowed.
 * Returns 403 if origin is not allowed.
 */
export function handlePreflight(request: Request, env: Env): Response {
  const corsHeaders = getCorsHeaders(request, env);

  // If no CORS headers returned, origin is not allowed
  if (Object.keys(corsHeaders).length === 0) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// =============================================
// RESPONSE WRAPPER
// =============================================

/**
 * Add CORS headers to an existing Response.
 * Call this on every response before returning from the router.
 */
export function addCorsHeaders(response: Response, request: Request, env: Env): Response {
  const corsHeaders = getCorsHeaders(request, env);

  // If no CORS headers needed, return response as-is
  if (Object.keys(corsHeaders).length === 0) {
    return response;
  }

  // Clone response and add CORS headers
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });

  for (const [key, value] of Object.entries(corsHeaders)) {
    newResponse.headers.set(key, value);
  }

  return newResponse;
}
