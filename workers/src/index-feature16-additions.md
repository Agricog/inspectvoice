/**
 * InspectVoice — Feature 16: Client Portal — index.ts Merge Guide
 * workers/src/index-feature16-additions.ts
 *
 * ══════════════════════════════════════════════════════════════════
 * MERGE INTO: workers/src/index.ts
 * This file is NOT standalone. Follow the numbered steps below.
 * ══════════════════════════════════════════════════════════════════
 */

// ══════════════════════════════════════════════════════════════════
// STEP 1: Add imports (after the existing Feature 15 imports)
// ══════════════════════════════════════════════════════════════════

// Paste these imports after the defect library imports:

// ── Feature 16: Client Portal (Inspector-Side Management) ──
import {
  createClientWorkspace,
  listClientWorkspaces,
  getClientWorkspace,
  updateClientWorkspace,
  inviteClientUser,
  listClientUsers,
  updateClientUser,
  deactivateClientUser,
  grantSiteAccess,
  listGrantedSites,
  revokeSiteAccess,
  listPendingClientUpdates,
  verifyClientUpdate,
} from './routes/clientWorkspaces';

// ── Feature 16: Client Portal Guard ──
import { portalGuard, verifyMagicLink } from './middleware/portalGuard';

// NOTE: Portal route handlers (Batch 16.3+) will be imported here later:
// import { ... } from './routes/portal';


// ══════════════════════════════════════════════════════════════════
// STEP 2: Add inspector-side routes to the ROUTES table
// (after the Defect Library routes, before the closing bracket)
// ══════════════════════════════════════════════════════════════════

// Paste these entries at the bottom of the ROUTES array:

  // ── Feature 16: Client Workspace Management (Inspector-Side) ──
  ['POST',   '/api/v1/client-workspaces', createClientWorkspace],
  ['GET',    '/api/v1/client-workspaces', listClientWorkspaces],
  ['GET',    '/api/v1/client-workspaces/:id', getClientWorkspace],
  ['PUT',    '/api/v1/client-workspaces/:id', updateClientWorkspace],
  ['POST',   '/api/v1/client-workspaces/:id/users', inviteClientUser],
  ['GET',    '/api/v1/client-workspaces/:id/users', listClientUsers],
  ['PUT',    '/api/v1/client-workspaces/:id/users/:userId', updateClientUser],
  ['DELETE', '/api/v1/client-workspaces/:id/users/:userId', deactivateClientUser],
  ['POST',   '/api/v1/client-workspaces/:id/sites', grantSiteAccess],
  ['GET',    '/api/v1/client-workspaces/:id/sites', listGrantedSites],
  ['DELETE', '/api/v1/client-workspaces/:id/sites/:siteId', revokeSiteAccess],
  ['GET',    '/api/v1/client-updates/pending', listPendingClientUpdates],
  ['PUT',    '/api/v1/client-updates/:id/verify', verifyClientUpdate],


// ══════════════════════════════════════════════════════════════════
// STEP 3: Add portal route handling to the fetch() handler
//
// Insert this block AFTER the "Public Verification (no auth)" block
// and BEFORE the "Authenticated Routes" for-loop.
//
// Position in fetch():
//   1. Webhook routes          ← existing
//   2. Health check            ← existing
//   3. Public verification     ← existing
//   4. ▶ Magic link routes     ← NEW (step 3a)
//   5. ▶ Portal routes         ← NEW (step 3b, added in Batch 16.3+)
//   6. Authenticated routes    ← existing
//   7. 404                     ← existing
// ══════════════════════════════════════════════════════════════════

// ── 3a: Magic Link Routes (no auth — token IS the credential) ──
// Paste this AFTER the "Public Verification" block:

      // ── Magic Link Routes (no auth — Feature 16) ──
      if (path.startsWith('/api/v1/portal/magic/') && method === 'GET') {
        const tokenMatch = path.match(/^\/api\/v1\/portal\/magic\/([a-zA-Z0-9_-]+)$/);
        if (tokenMatch && tokenMatch[1]) {
          const magicToken = tokenMatch[1];
          const magicCtx = await verifyMagicLink(request, magicToken, env);
          // Magic link resource resolution will be wired in Batch 16.5
          const response = new Response(JSON.stringify({
            success: true,
            data: {
              resource_type: magicCtx.resourceType,
              resource_id: magicCtx.resourceId,
              message: 'Magic link verified. Resource handler pending.',
            },
            requestId: magicCtx.requestId,
          }), {
            headers: { 'Content-Type': 'application/json' },
          });
          return addCorsHeaders(response, request, env);
        }
      }

// ── 3b: Portal Routes (client auth — added in Batch 16.3+) ──
// This placeholder block will be replaced with actual portal route
// matching when portal read/write endpoints are built.
// Paste this AFTER the magic link block, BEFORE authenticated routes:

      // ── Portal Routes (client auth — Feature 16) ──
      // Portal routes use portalGuard, NOT guard.
      // Wired in Batch 16.3+ when portal endpoint handlers exist.
      // Pattern: /api/v1/portal/* → portalGuard(request, env) → handler
      //
      // if (path.startsWith('/api/v1/portal/') && !path.startsWith('/api/v1/portal/magic/')) {
      //   const portalCtx = await portalGuard(request, env);
      //   // Route matching for portal endpoints here
      // }


// ══════════════════════════════════════════════════════════════════
// STEP 4: Add portal Clerk env vars to wrangler.toml [vars] section
// (these are secrets — set via Cloudflare dashboard, not in toml)
//
// Secrets to configure when Clerk portal app is created:
//   PORTAL_CLERK_JWKS_URL
//   PORTAL_CLERK_SECRET_KEY
//   PORTAL_CLERK_ISSUER
//   PORTAL_CLERK_AUTHORIZED_PARTIES
// ══════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════
// STEP 5: Add portal Clerk env vars to Env interface in types.ts
//
// Add these 4 lines under "// ── Client Portal Clerk ──":
//
//   readonly PORTAL_CLERK_JWKS_URL: string;
//   readonly PORTAL_CLERK_SECRET_KEY: string;
//   readonly PORTAL_CLERK_ISSUER: string;
//   readonly PORTAL_CLERK_AUTHORIZED_PARTIES: string;
// ══════════════════════════════════════════════════════════════════
