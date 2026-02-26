/**
 * InspectVoice — Portal Guard Middleware
 * workers/src/middleware/portalGuard.ts
 *
 * THE security boundary for all client portal API routes (/api/v1/portal/*).
 *
 * This is a COMPLETELY SEPARATE auth boundary from guard.ts.
 * It verifies JWTs from a different Clerk application (the client portal
 * Clerk instance), maps them to client workspaces, and builds a
 * PortalRequestContext that is structurally incompatible with RequestContext.
 *
 * Key differences from guard.ts:
 *   1. Uses PORTAL_CLERK_* env vars (different Clerk instance)
 *   2. Resolves client_workspace_id from Clerk org (DB lookup)
 *   3. Resolves client_user from Clerk user ID (DB lookup)
 *   4. Returns PortalRequestContext (not RequestContext)
 *   5. Maintains its own JWKS cache (separate key rotation)
 *   6. Role hierarchy: viewer < contributor < admin (not inspector < manager < admin)
 *
 * Also provides magic link verification for token-based resource access
 * with no Clerk auth required (token_hash + expiry + use count + audit metadata).
 *
 * Build Standard: Autaimate v3 §5.1 — strictly enforced, no shortcuts
 */

import { neon } from '@neondatabase/serverless';
import type { Env, PortalRequestContext, MagicLinkContext, ClientUserRole, ClientMagicLinkResourceType } from '../types';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../shared/errors';

// =============================================
// PORTAL JWKS CACHE (separate from inspector guard)
// =============================================

/**
 * Completely separate JWKS cache from the inspector guard.
 * The client portal uses a different Clerk application with its own
 * key rotation schedule. Sharing caches would be a security defect.
 */
interface PortalJwksCache {
  keys: PortalJwkWithKid[];
  fetchedAt: number;
}

let portalJwksCache: PortalJwksCache | null = null;

/** JWKS cache TTL — 1 hour */
const PORTAL_JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Clock skew tolerance — 5 minutes */
const PORTAL_MAX_CLOCK_SKEW_SECONDS = 300;

// =============================================
// PORTAL GUARD ENTRY POINT
// =============================================

/**
 * Authenticate and authorise a client portal request.
 *
 * Flow:
 *   1. Extract + verify JWT (Portal Clerk instance)
 *   2. Extract clerk_org_id → look up client_workspace (DB)
 *   3. Extract clerk_user_id → look up client_user (DB)
 *   4. Verify workspace is active + user is active
 *   5. Build PortalRequestContext
 *   6. Update last_login_at (fire-and-forget)
 *
 * @throws UnauthorizedError — missing/invalid token, unknown user
 * @throws ForbiddenError — inactive workspace/user, no org
 */
export async function portalGuard(request: Request, env: Env): Promise<PortalRequestContext> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const method = request.method;
  const url = new URL(request.url);
  const path = url.pathname;

  // ── 1. Extract Bearer token ──
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

  // ── 2. Verify JWT against PORTAL Clerk instance ──
  const payload = await verifyPortalClerkJwt(token, env);

  // ── 3. Extract user identity ──
  const clerkUserId = payload.sub;
  if (!clerkUserId) {
    throw new UnauthorizedError('JWT missing sub claim');
  }

  // ── 4. Extract org identity (Clerk v1 or v2 format) ──
  const clerkOrgId = payload.org_id ?? payload.o?.id;
  if (!clerkOrgId) {
    throw new ForbiddenError('No active organisation. Please select your workspace.');
  }

  // ── 5. Resolve client workspace from Clerk org (DB lookup) ──
  const sql = neon(env.DATABASE_URL);

  const workspaceRows = await sql`
    SELECT id, name, status
    FROM client_workspaces
    WHERE clerk_org_id = ${clerkOrgId}
    LIMIT 1
  `;

  const workspace = workspaceRows[0] as { id: string; name: string; status: string } | undefined;
  if (!workspace) {
    throw new UnauthorizedError('Client workspace not found for this organisation');
  }

  if (workspace.status !== 'active') {
    throw new ForbiddenError(`Client workspace is ${workspace.status}. Contact your inspection provider.`);
  }

  // ── 6. Resolve client user (DB lookup) ──
  const userRows = await sql`
    SELECT id, name, role, is_active
    FROM client_users
    WHERE clerk_user_id = ${clerkUserId}
      AND client_workspace_id = ${workspace.id}
    LIMIT 1
  `;

  const clientUser = userRows[0] as {
    id: string;
    name: string;
    role: ClientUserRole;
    is_active: boolean;
  } | undefined;

  if (!clientUser) {
    throw new UnauthorizedError('Client user not found. Please contact your administrator.');
  }

  if (!clientUser.is_active) {
    throw new ForbiddenError('Your account has been deactivated. Contact your administrator.');
  }

  // ── 7. Build context ──
  const ctx: PortalRequestContext = {
    requestId,
    clientUserId: clerkUserId,
    clientUserDbId: clientUser.id,
    clientWorkspaceId: workspace.id,
    clientRole: clientUser.role,
    clientUserName: clientUser.name,
    method,
    path,
    startedAt,
    env,
  };

  // ── 8. Update last_login_at (fire-and-forget, non-blocking) ──
  sql`
    UPDATE client_users
    SET last_login_at = NOW()
    WHERE id = ${clientUser.id}
  `.catch(() => {
    // Non-critical — don't block the request if this fails
  });

  // ── 9. Log ──
  // Note: Logger.fromPortalContext needs adding to shared/logger.ts.
  // Until then, use structured console log with requestId prefix.
  console.log(JSON.stringify({
    level: 'debug',
    message: 'Portal request authenticated',
    requestId,
    clientWorkspaceId: workspace.id,
    clientRole: clientUser.role,
    workspaceName: workspace.name,
    timestamp: new Date().toISOString(),
  }));

  return ctx;
}

// =============================================
// MAGIC LINK VERIFICATION
// =============================================

/**
 * Verify a magic link token and return a scoped MagicLinkContext.
 *
 * Flow:
 *   1. SHA-256 hash the incoming plaintext token
 *   2. Look up by token_hash
 *   3. Check expiry
 *   4. Check use_count < max_uses
 *   5. Increment use_count + log access metadata
 *   6. Return MagicLinkContext
 *
 * No Clerk auth required — the token IS the credential.
 * Rate-limited at the route level (30/min by IP).
 *
 * @throws UnauthorizedError — invalid/expired/exhausted token
 */
export async function verifyMagicLink(
  request: Request,
  token: string,
  env: Env,
): Promise<MagicLinkContext> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const method = request.method;
  const url = new URL(request.url);
  const path = url.pathname;

  if (!token || token.length < 32) {
    throw new UnauthorizedError('Invalid magic link token');
  }

  // ── 1. Hash the token (we never query by plaintext) ──
  const tokenHash = await sha256Hex(token);

  // ── 2. Look up by hash ──
  const sql = neon(env.DATABASE_URL);

  const rows = await sql`
    SELECT
      id, client_workspace_id, resource_type, resource_id,
      expires_at, max_uses, use_count
    FROM client_magic_links
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;

  const link = rows[0] as {
    id: string;
    client_workspace_id: string;
    resource_type: ClientMagicLinkResourceType;
    resource_id: string;
    expires_at: string;
    max_uses: number;
    use_count: number;
  } | undefined;

  if (!link) {
    throw new UnauthorizedError('Magic link not found or has been revoked');
  }

  // ── 3. Check expiry ──
  const now = new Date();
  const expiresAt = new Date(link.expires_at);
  if (now > expiresAt) {
    throw new UnauthorizedError('Magic link has expired');
  }

  // ── 4. Check use count ──
  if (link.use_count >= link.max_uses) {
    throw new UnauthorizedError('Magic link has reached its maximum number of uses');
  }

  // ── 5. Collect access metadata for audit ──
  const ipAddress = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';
  const ipHash = await sha256Hex(ipAddress);
  const userAgent = (request.headers.get('User-Agent') ?? 'unknown').slice(0, 500);
  const isFirstAccess = link.use_count === 0;

  // ── 6. Increment use_count + log access metadata (atomic) ──
  await sql`
    UPDATE client_magic_links
    SET
      use_count = use_count + 1,
      first_accessed_at = CASE
        WHEN ${isFirstAccess} THEN NOW()
        ELSE first_accessed_at
      END,
      last_accessed_at = NOW(),
      last_accessed_ip_hash = ${ipHash},
      last_accessed_user_agent = ${userAgent}
    WHERE id = ${link.id}
      AND use_count < max_uses
  `;

  // ── 7. Build context ──
  return {
    requestId,
    magicLinkId: link.id,
    clientWorkspaceId: link.client_workspace_id,
    resourceType: link.resource_type,
    resourceId: link.resource_id,
    method,
    path,
    startedAt,
    env,
  };
}

// =============================================
// PORTAL JWT VERIFICATION
// =============================================

/**
 * Verify a JWT from the Portal Clerk instance.
 * Identical algorithm to guard.ts but uses PORTAL_CLERK_* env vars
 * and a separate JWKS cache.
 */
async function verifyPortalClerkJwt(token: string, env: Env): Promise<PortalClerkJwtPayload> {
  // ── Split JWT parts ──
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('Malformed JWT');
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  // ── Decode header to get kid ──
  const header = decodeJwtPart<PortalJwtHeader>(headerB64);
  if (header.alg !== 'RS256') {
    throw new UnauthorizedError('Unsupported JWT algorithm');
  }
  if (!header.kid) {
    throw new UnauthorizedError('JWT missing kid header');
  }

  // ── Get the signing key from PORTAL Clerk JWKS ──
  const publicKey = await getPortalSigningKey(header.kid, env);

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
  const payload = decodeJwtPart<PortalClerkJwtPayload>(payloadB64);
  validatePortalJwtClaims(payload, env);

  return payload;
}

/**
 * Validate portal JWT claims against PORTAL Clerk env vars.
 */
function validatePortalJwtClaims(payload: PortalClerkJwtPayload, env: Env): void {
  const now = Math.floor(Date.now() / 1000);

  // Expiry
  if (payload.exp && payload.exp + PORTAL_MAX_CLOCK_SKEW_SECONDS < now) {
    throw new UnauthorizedError('JWT has expired');
  }

  // Not-before
  if (payload.nbf && payload.nbf - PORTAL_MAX_CLOCK_SKEW_SECONDS > now) {
    throw new UnauthorizedError('JWT is not yet valid');
  }

  // Issuer — must match PORTAL Clerk instance (NOT the inspector instance)
  const expectedIssuer = env.PORTAL_CLERK_ISSUER;
  if (!expectedIssuer) {
    throw new UnauthorizedError('PORTAL_CLERK_ISSUER not configured');
  }
  if (!payload.iss || payload.iss !== expectedIssuer) {
    throw new UnauthorizedError('JWT issuer mismatch');
  }

  // Authorized parties
  const allowedParties = parseCsv(env.PORTAL_CLERK_AUTHORIZED_PARTIES);
  if (allowedParties.length === 0) {
    throw new UnauthorizedError('PORTAL_CLERK_AUTHORIZED_PARTIES not configured');
  }

  const azp = (payload as unknown as { azp?: string }).azp;
  if (!azp) {
    throw new UnauthorizedError('JWT missing azp claim');
  }
  if (!allowedParties.includes(azp)) {
    throw new UnauthorizedError('JWT authorized party (azp) not allowed');
  }
}

// =============================================
// PORTAL JWKS MANAGEMENT
// =============================================

/**
 * Get a CryptoKey from the PORTAL Clerk JWKS.
 * Uses its own cache, separate from the inspector guard.
 */
async function getPortalSigningKey(kid: string, env: Env): Promise<CryptoKey> {
  const keys = await fetchPortalJwks(env);
  const matchingKey = keys.find((k) => k.kid === kid);

  if (!matchingKey) {
    // Cache might be stale — force refresh once
    portalJwksCache = null;
    const refreshedKeys = await fetchPortalJwks(env);
    const retryKey = refreshedKeys.find((k) => k.kid === kid);

    if (!retryKey) {
      throw new UnauthorizedError('JWT signing key not found in portal JWKS');
    }

    return importPortalRsaKey(retryKey);
  }

  return importPortalRsaKey(matchingKey);
}

/**
 * Fetch JWKS from the PORTAL Clerk instance.
 */
async function fetchPortalJwks(env: Env): Promise<PortalJwkWithKid[]> {
  if (portalJwksCache && (Date.now() - portalJwksCache.fetchedAt) < PORTAL_JWKS_CACHE_TTL_MS) {
    return portalJwksCache.keys;
  }

  const jwksUrl = env.PORTAL_CLERK_JWKS_URL;
  if (!jwksUrl) {
    throw new UnauthorizedError('PORTAL_CLERK_JWKS_URL not configured');
  }

  const response = await fetch(jwksUrl, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new UnauthorizedError('Failed to fetch JWKS from Portal Clerk');
  }

  const data = await response.json() as PortalJwksResponse;

  if (!data.keys || !Array.isArray(data.keys) || data.keys.length === 0) {
    throw new UnauthorizedError('Portal JWKS response contains no keys');
  }

  portalJwksCache = {
    keys: data.keys,
    fetchedAt: Date.now(),
  };

  return data.keys;
}

/**
 * Import a JWK as a CryptoKey for RS256 signature verification.
 */
async function importPortalRsaKey(jwk: PortalJwkWithKid): Promise<CryptoKey> {
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
// PORTAL ROLE-BASED ACCESS HELPERS
// =============================================

/**
 * Check if the client user has at least the required role level.
 * Role hierarchy: viewer (1) < contributor (2) < admin (3)
 *
 * Usage in portal routes:
 *   requirePortalRole(ctx, 'contributor'); // throws ForbiddenError if viewer
 */
export function requirePortalRole(
  ctx: PortalRequestContext,
  minimumRole: ClientUserRole,
): void {
  const hierarchy: Record<string, number> = {
    viewer: 1,
    contributor: 2,
    admin: 3,
  };

  const userLevel = hierarchy[ctx.clientRole] ?? 0;
  const requiredLevel = hierarchy[minimumRole] ?? 0;

  if (userLevel < requiredLevel) {
    throw new ForbiddenError(`This action requires ${minimumRole} role or higher`);
  }
}

/**
 * Verify that the client workspace has access to a specific site.
 * Used by portal routes that scope data by site.
 *
 * @throws ForbiddenError if the workspace has no access to the site
 */
export async function requirePortalSiteAccess(
  ctx: PortalRequestContext,
  siteId: string,
): Promise<void> {
  const sql = neon(ctx.env.DATABASE_URL);

  const rows = await sql`
    SELECT id FROM client_site_access
    WHERE client_workspace_id = ${ctx.clientWorkspaceId}
      AND site_id = ${siteId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new ForbiddenError('Your workspace does not have access to this site');
  }
}

/**
 * Verify that a defect belongs to a site the client workspace has access to.
 * Used by portal routes that allow client defect updates.
 *
 * @returns The defect's site_id (useful for downstream logic)
 * @throws ForbiddenError if the defect's site is not accessible
 * @throws NotFoundError if the defect doesn't exist
 */
export async function requirePortalDefectAccess(
  ctx: PortalRequestContext,
  defectId: string,
): Promise<string> {
  const sql = neon(ctx.env.DATABASE_URL);

  const rows = await sql`
    SELECT d.site_id
    FROM defects d
    INNER JOIN client_site_access csa
      ON csa.site_id = d.site_id
      AND csa.client_workspace_id = ${ctx.clientWorkspaceId}
    WHERE d.id = ${defectId}
    LIMIT 1
  `;

  const row = rows[0] as { site_id: string } | undefined;
  if (!row) {
    throw new NotFoundError('Defect not found or not accessible from your workspace');
  }

  return row.site_id;
}

// =============================================
// CRYPTO HELPERS
// =============================================

/**
 * SHA-256 hash a string and return the hex digest.
 * Used for magic link token hashing and IP address hashing.
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// =============================================
// JWT DECODE/VERIFY HELPERS
// =============================================

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

/** Convert base64url string to ArrayBuffer */
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

/** Parse a comma-separated env var into trimmed values */
function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// =============================================
// INTERNAL TYPES (portal-specific, not exported)
// =============================================

/**
 * Portal Clerk JWT payload. Same structure as inspector JWT but verified
 * against the PORTAL Clerk instance. Supports both v1 and v2 formats.
 */
interface PortalClerkJwtPayload {
  readonly sub: string;
  readonly azp?: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly nbf?: number;
  readonly iss?: string;
  readonly sid?: string;
  readonly v?: number;

  // Clerk v1 org claims
  readonly org_id?: string;
  readonly org_role?: string;

  // Clerk v2 org claims
  readonly o?: {
    readonly id: string;
    readonly rol: string;
    readonly slg?: string;
  };
}

interface PortalJwtHeader {
  readonly alg: string;
  readonly kid?: string;
  readonly typ?: string;
}

interface PortalJwkWithKid extends JsonWebKey {
  readonly kid: string;
}

interface PortalJwksResponse {
  readonly keys: PortalJwkWithKid[];
}
