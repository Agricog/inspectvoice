/**
 * InspectVoice — Guard Middleware
 * THE security boundary for all authenticated API routes.
 *
 * Every request to /api/v1/* (except webhooks) passes through this guard.
 * It provides:
 *
 * 1. requestId — unique per request, attached to all logs and responses
 * 2. Clerk JWT verification — RS256 signature check via JWKS
 * 3. userId derivation — from JWT `sub` claim (NEVER from request body)
 * 4. orgId derivation — from JWT `org_id` or `o.id` claim (NEVER from request body)
 * 5. Role derivation — from JWT `org_role` or `o.rol` claim
 * 6. READ_ONLY_MODE enforcement — blocks writes when enabled
 * 7. RequestContext creation — injected into every route handler
 *
 * Multi-tenancy isolation starts here: orgId comes ONLY from the verified JWT.
 * No endpoint may accept a tenant ID from the client without verification.
 *
 * Supports both Clerk v1 (org_id, org_role at top level) and
 * Clerk v2 (o.id, o.rol nested object) JWT formats.
 *
 * Build Standard: Autaimate v3 §5.1 — strictly enforced, no shortcuts
 */

import type { Env, RequestContext, ClerkJwtPayload } from '../types';
import { UnauthorizedError, ForbiddenError, ServiceUnavailableError } from '../shared/errors';
import { Logger } from '../shared/logger';

// =============================================
// JWKS CACHE
// =============================================

/**
 * In-memory JWKS cache.
 * Cloudflare Workers have no persistent memory between requests in different
 * isolates, but within a single isolate, globals persist across requests.
 * This gives us a best-effort cache that reduces JWKS fetch frequency.
 */
interface JwksCache {
  keys: JsonWebKey[];
  fetchedAt: number;
}

let jwksCache: JwksCache | null = null;

/** JWKS cache TTL — 1 hour (Clerk rotates keys infrequently) */
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Maximum age of a JWT we'll accept (5 minutes of clock skew tolerance) */
const MAX_CLOCK_SKEW_SECONDS = 300;

// =============================================
// GUARD ENTRY POINT
// =============================================

/**
 * Authenticate and authorise a request, returning a RequestContext.
 *
 * @param request — incoming Request
 * @param env — Cloudflare environment bindings
 * @returns RequestContext for use in route handlers
 * @throws UnauthorizedError if JWT is missing, invalid, or expired
 * @throws ForbiddenError if user has no active organisation
 * @throws ServiceUnavailableError if READ_ONLY_MODE is active and method is a write
 */
export async function guard(request: Request, env: Env): Promise<RequestContext> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const method = request.method;
  const url = new URL(request.url);
  const path = url.pathname;

  // ── 1. Check READ_ONLY_MODE for write operations ──
  if (env.READ_ONLY_MODE === 'true' && isWriteMethod(method)) {
    throw new ServiceUnavailableError('System is in read-only mode. Write operations are temporarily disabled.');
  }

  // ── 2. Extract Bearer token ──
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    throw new UnauthorizedError('Missing Authorization header');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authorization header must use Bearer scheme');
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new UnauthorizedError('Bearer token is empty');
  }

  // ── 3. Verify JWT ──
  const payload = await verifyClerkJwt(token, env);

  // ── 4. Extract claims ──
  const userId = payload.sub;
  if (!userId) {
    throw new UnauthorizedError('JWT missing sub claim');
  }

  // org_id is required — user must have an active organisation
  // Supports both Clerk v1 (org_id at top level) and v2 (o.id nested)
  const orgId = payload.org_id ?? payload.o?.id;
  if (!orgId) {
    throw new ForbiddenError('No active organisation. Please select or create an organisation.');
  }

  // Role: Clerk v1 uses org_role, v2 uses o.rol
  const userRole = payload.org_role ?? payload.o?.rol ?? 'inspector';

  // ── 5. Build context ──
  const ctx: RequestContext = {
    requestId,
    userId,
    orgId,
    userRole,
    method,
    path,
    startedAt,
    env,
  };

  // ── 6. Log request start (debug level — not noisy in production) ──
  const logger = Logger.fromContext(ctx);
  logger.debug('Request authenticated', {
    userRole,
  });

  return ctx;
}

// =============================================
// JWT VERIFICATION
// =============================================

/**
 * Verify a Clerk JWT using RS256 and the Clerk JWKS endpoint.
 *
 * Steps:
 * 1. Decode the JWT header to get the `kid` (key ID)
 * 2. Fetch/cache the JWKS from Clerk
 * 3. Find the matching key
 * 4. Verify the RS256 signature using Web Crypto API
 * 5. Validate claims (exp, nbf, iss)
 *
 * @returns Verified JWT payload
 * @throws UnauthorizedError on any verification failure
 */
async function verifyClerkJwt(token: string, env: Env): Promise<ClerkJwtPayload> {
  // ── Split JWT parts ──
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('Malformed JWT');
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  // ── Decode header to get kid ──
  const header = decodeJwtPart<JwtHeader>(headerB64);
  if (header.alg !== 'RS256') {
    throw new UnauthorizedError('Unsupported JWT algorithm');
  }
  if (!header.kid) {
    throw new UnauthorizedError('JWT missing kid header');
  }

  // ── Get the signing key ──
  const publicKey = await getSigningKey(header.kid, env);

  // ── Verify signature ──
  const signedContent = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToArrayBuffer(signatureB64);

  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signature,
    signedContent,
  );

  if (!isValid) {
    throw new UnauthorizedError('JWT signature verification failed');
  }

  // ── Decode and validate payload ──
  const payload = decodeJwtPart<ClerkJwtPayload>(payloadB64);
  validateJwtClaims(payload);

  return payload;
}

/**
 * Validate JWT claims: expiry, not-before, issuer.
 */
function validateJwtClaims(payload: ClerkJwtPayload): void {
  const now = Math.floor(Date.now() / 1000);

  // Check expiry (with clock skew tolerance)
  if (payload.exp && payload.exp + MAX_CLOCK_SKEW_SECONDS < now) {
    throw new UnauthorizedError('JWT has expired');
  }

  // Check not-before (with clock skew tolerance)
  if (payload.nbf && payload.nbf - MAX_CLOCK_SKEW_SECONDS > now) {
    throw new UnauthorizedError('JWT is not yet valid');
  }

  // Verify issuer matches a Clerk domain
  if (payload.iss && !payload.iss.includes('clerk')) {
    throw new UnauthorizedError('JWT issuer is not recognised');
  }
}

// =============================================
// JWKS MANAGEMENT
// =============================================

/**
 * Get the CryptoKey for a given key ID from the Clerk JWKS.
 * Uses an in-memory cache with 1-hour TTL.
 */
async function getSigningKey(kid: string, env: Env): Promise<CryptoKey> {
  const keys = await fetchJwks(env);
  const matchingKey = keys.find((k) => k.kid === kid);

  if (!matchingKey) {
    // Key not found — cache might be stale. Force refresh once.
    jwksCache = null;
    const refreshedKeys = await fetchJwks(env);
    const retryKey = refreshedKeys.find((k) => k.kid === kid);

    if (!retryKey) {
      throw new UnauthorizedError('JWT signing key not found in JWKS');
    }

    return importRsaKey(retryKey);
  }

  return importRsaKey(matchingKey);
}

/**
 * Fetch the JWKS from Clerk, with caching.
 */
async function fetchJwks(env: Env): Promise<JwkWithKid[]> {
  // Return cached keys if still fresh
  if (jwksCache && (Date.now() - jwksCache.fetchedAt) < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys as JwkWithKid[];
  }

  const jwksUrl = env.CLERK_JWKS_URL;
  if (!jwksUrl) {
    throw new UnauthorizedError('JWKS URL not configured');
  }

  const response = await fetch(jwksUrl, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new UnauthorizedError('Failed to fetch JWKS from Clerk');
  }

  const data = await response.json() as JwksResponse;

  if (!data.keys || !Array.isArray(data.keys) || data.keys.length === 0) {
    throw new UnauthorizedError('JWKS response contains no keys');
  }

  // Cache the keys
  jwksCache = {
    keys: data.keys,
    fetchedAt: Date.now(),
  };

  return data.keys as JwkWithKid[];
}

/**
 * Import a JWK as a CryptoKey for signature verification.
 */
async function importRsaKey(jwk: JwkWithKid): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify'],
  );
}

// =============================================
// ROLE-BASED ACCESS HELPERS
// =============================================

/**
 * Check if the user has at least the required role level.
 * Role hierarchy: admin > manager > inspector
 *
 * Usage in routes:
 *   requireRole(ctx, 'manager'); // throws ForbiddenError if inspector
 */
export function requireRole(ctx: RequestContext, minimumRole: 'inspector' | 'manager' | 'admin'): void {
  const hierarchy: Record<string, number> = {
    'inspector': 1,
    'org:inspector': 1,
    'manager': 2,
    'org:manager': 2,
    'admin': 3,
    'org:admin': 3,
  };

  const userLevel = hierarchy[ctx.userRole] ?? 0;
  const requiredLevel = hierarchy[minimumRole] ?? 0;

  if (userLevel < requiredLevel) {
    throw new ForbiddenError(`This action requires ${minimumRole} role or higher`);
  }
}

// =============================================
// WEBHOOK GUARD (no Clerk auth, signature-based)
// =============================================

/**
 * Create a WebhookContext for webhook handlers.
 * No JWT verification — webhooks use signature verification instead.
 */
export function createWebhookContext(request: Request, env: Env): {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
  env: Env;
} {
  return {
    requestId: crypto.randomUUID(),
    method: request.method,
    path: new URL(request.url).pathname,
    startedAt: Date.now(),
    env,
  };
}

// =============================================
// HELPERS
// =============================================

/** Check if an HTTP method is a write operation */
function isWriteMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

/** Decode a base64url-encoded JWT part to JSON */
function decodeJwtPart<T>(base64url: string): T {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const text = new TextDecoder().decode(
    Uint8Array.from(binary, (c) => c.charCodeAt(0)),
  );

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UnauthorizedError('JWT contains invalid JSON');
  }
}

/** Convert base64url string to ArrayBuffer (for signature verification) */
function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

// =============================================
// INTERNAL TYPES
// =============================================

interface JwtHeader {
  readonly alg: string;
  readonly kid?: string;
  readonly typ?: string;
}

interface JwkWithKid extends JsonWebKey {
  readonly kid: string;
}

interface JwksResponse {
  readonly keys: JwkWithKid[];
}
