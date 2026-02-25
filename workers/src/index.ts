// =============================================
// FEATURE 10: ADDITIONS TO workers/src/index.ts
// =============================================

// ── 1. ADD IMPORTS (at top, with other route imports) ──────────────

import { verifyBundle } from './routes/verify';
import {
  createSealedDefectExport,
  createSealedPdfExport,
  createSealedClaimsPack,
  downloadSealedExport,
  listSealedExports,
} from './routes/sealedExport';


// ── 2. ADD TO ROUTES ARRAY (after Incidents section) ───────────────

  // ── Sealed Exports ──
  ['POST', '/api/v1/sealed-exports/defects', createSealedDefectExport],
  ['POST', '/api/v1/sealed-exports/inspections/:id/pdf', createSealedPdfExport],
  ['POST', '/api/v1/sealed-exports/incidents/:id/claims-pack', createSealedClaimsPack],
  ['GET',  '/api/v1/sealed-exports/:bundleId/download', downloadSealedExport],
  ['GET',  '/api/v1/sealed-exports', listSealedExports],


// ── 3. ADD PUBLIC VERIFY ROUTE (in fetch handler, AFTER webhooks, BEFORE auth) ──
//    Insert this block right after the webhook loop and health check,
//    BEFORE the "for (const [routeMethod, pattern, handler] of ROUTES)" loop:

      // ── Public Verification (no auth — same bypass pattern as webhooks) ──
      if (path.startsWith('/api/v1/verify/') && method === 'GET') {
        const response = await verifyBundle(request, env);
        return addCorsHeaders(response, request, env);
      }


// ── 4. WRANGLER.TOML — No new R2 bucket needed ────────────────────
//    Uses existing INSPECTVOICE_BUCKET with prefix: sealed-exports/{org_id}/

// ── 5. CLOUDFLARE SECRETS — Add via wrangler CLI ───────────────────
//    npx wrangler secret put MANIFEST_SIGNING_KEY
//      → Paste output of: openssl rand -hex 32
//    npx wrangler secret put MANIFEST_SIGNING_KEY_ID
//      → Enter: k1
//    npx wrangler secret put MANIFEST_SIGNING_KEYS_LEGACY
//      → Enter: {}

// ── 6. WORKER DEPENDENCY ───────────────────────────────────────────
//    cd workers && npm install fflate
