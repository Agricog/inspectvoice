/**
 * InspectVoice — Cloudflare Worker Entry Point
 * Routes all HTTP requests and queue messages to their handlers.
 *
 * Request lifecycle:
 *   1. CORS preflight handling
 *   2. Webhook routes (signature-verified, no JWT)
 *   3. Public verification (no JWT — Feature 10)
 *   4. Authenticated routes (Clerk JWT → guard → route handler)
 *   5. Error boundary (catches all errors, returns structured JSON)
 *   6. CORS headers on every response
 *
 * Queue lifecycle:
 *   - AUDIO_PROCESSING_QUEUE → audioProcessor
 *   - PDF_GENERATION_QUEUE → pdfGenerator
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { Env, QueueMessageBody, RouteHandler, RouteParams, WebhookHandler } from './types';
import { guard, createWebhookContext } from './middleware/guard';
import { handlePreflight, addCorsHeaders } from './middleware/cors';
import { formatErrorResponse } from './shared/errors';
import { Logger } from './shared/logger';

// ── Route Handlers ──
import { listSites, getSite, createSite, updateSite } from './routes/sites';
import { listAssetsBySite, getAsset, createAsset, updateAsset } from './routes/assets';
import { getAssetHistory } from './routes/assetHistory';
import { listInspections, getInspection, createInspection, updateInspection } from './routes/inspections';
import { listInspectionItems, createInspectionItem, updateInspectionItem, getAiStatus } from './routes/inspectionItems';
import { requestPhotoUpload, requestAudioUpload, proxyUploadToR2, confirmPhotoUpload, confirmAudioUpload, downloadFile } from './routes/uploads';
import { listDefects, getDefect, updateDefect } from './routes/defects';
import { exportDefects } from './routes/defectsExport';
import { getMe, updateMe } from './routes/users';
import { getOrgSettings, updateOrgSettings } from './routes/org';
import { getDashboardStats } from './routes/dashboard';
import { triggerPdfGeneration, downloadPdf } from './routes/pdf';
import { createMakeSafeAction, listMakeSafeActions, recentMakeSafeActions } from './routes/makeSafe';
import { listIncidents, getIncident, createIncident, updateIncident } from './routes/incidents';
import { getClaimsPack } from './routes/claimsPack';

// ── Feature 10: Sealed Exports ──
import { verifyBundle } from './routes/verify';
import {
  createSealedDefectExport,
  createSealedPdfExport,
  createSealedClaimsPack,
  downloadSealedExport,
  listSealedExports,
} from './routes/sealedExport';

// ── Webhook Handlers ──
import { handleStripeWebhook } from './routes/webhooks/stripe';
import { handleClerkWebhook } from './routes/webhooks/clerk';

// ── Queue Consumers ──
import { handleAudioQueue } from './queues/audioProcessor';
import { handlePdfQueue } from './queues/pdfGenerator';

// =============================================
// ROUTE TABLE
// =============================================

/**
 * Route definitions: [method, pattern, handler]
 * Patterns use :param syntax for path parameters.
 * Order matters — first match wins.
 */
const ROUTES: Array<[string, string, RouteHandler]> = [
  // ── Sites ──
  ['GET', '/api/v1/sites', listSites],
  ['GET', '/api/v1/sites/:id', getSite],
  ['POST', '/api/v1/sites', createSite],
  ['PUT', '/api/v1/sites/:id', updateSite],

  // ── Assets ──
  ['GET', '/api/v1/sites/:siteId/assets', listAssetsBySite],
  ['GET', '/api/v1/assets/:id/history', getAssetHistory],
  ['GET', '/api/v1/assets/:id', getAsset],
  ['POST', '/api/v1/assets', createAsset],
  ['PUT', '/api/v1/assets/:id', updateAsset],

  // ── Inspections ──
  ['GET', '/api/v1/inspections', listInspections],
  ['GET', '/api/v1/inspections/:id', getInspection],
  ['POST', '/api/v1/inspections', createInspection],
  ['PUT', '/api/v1/inspections/:id', updateInspection],

  // ── Inspection Items ──
  ['GET', '/api/v1/inspection-items/:inspectionId', listInspectionItems],
  ['POST', '/api/v1/inspection-items', createInspectionItem],
  ['PUT', '/api/v1/inspection-items/:id', updateInspectionItem],
  ['GET', '/api/v1/inspection-items/:id/ai-status', getAiStatus],

  // ── Uploads ──
  ['POST', '/api/v1/uploads/photo', requestPhotoUpload],
  ['POST', '/api/v1/uploads/audio', requestAudioUpload],
  ['PUT', '/api/v1/uploads/put/:r2Key', proxyUploadToR2],
  ['POST', '/api/v1/uploads/photo/:r2Key/confirm', confirmPhotoUpload],
  ['POST', '/api/v1/uploads/audio/:r2Key/confirm', confirmAudioUpload],
  ['GET', '/api/v1/files/:r2Key', downloadFile],

  // ── Defects ──
  ['GET', '/api/v1/defects', listDefects],
  ['GET', '/api/v1/defects/export', exportDefects],
  ['GET', '/api/v1/defects/:id', getDefect],
  ['PUT', '/api/v1/defects/:id', updateDefect],

  // ── Make Safe ──
  ['POST', '/api/v1/defects/:defectId/make-safe', createMakeSafeAction],
  ['GET', '/api/v1/defects/:defectId/make-safe', listMakeSafeActions],
  ['GET', '/api/v1/make-safe/recent', recentMakeSafeActions],

  // ── Incidents ──
  ['GET', '/api/v1/incidents', listIncidents],
  ['GET', '/api/v1/incidents/:id/claims-pack', getClaimsPack],
  ['GET', '/api/v1/incidents/:id', getIncident],
  ['POST', '/api/v1/incidents', createIncident],
  ['PUT', '/api/v1/incidents/:id', updateIncident],

  // ── PDF ──
  ['POST', '/api/v1/inspections/:id/pdf', triggerPdfGeneration],
  ['GET', '/api/v1/inspections/:id/pdf', downloadPdf],

  // ── Users ──
  ['GET', '/api/v1/users/me', getMe],
  ['PUT', '/api/v1/users/me', updateMe],

  // ── Organisation ──
  ['GET', '/api/v1/org/settings', getOrgSettings],
  ['PUT', '/api/v1/org/settings', updateOrgSettings],

  // ── Dashboard ──
  ['GET', '/api/v1/dashboard/stats', getDashboardStats],

  // ── Sealed Exports (Feature 10) ──
  ['POST', '/api/v1/sealed-exports/defects', createSealedDefectExport],
  ['POST', '/api/v1/sealed-exports/inspections/:id/pdf', createSealedPdfExport],
  ['POST', '/api/v1/sealed-exports/incidents/:id/claims-pack', createSealedClaimsPack],
  ['GET',  '/api/v1/sealed-exports/:bundleId/download', downloadSealedExport],
  ['GET',  '/api/v1/sealed-exports', listSealedExports],
];

/**
 * Webhook routes — bypass JWT auth, use signature verification.
 */
const WEBHOOK_ROUTES: Array<[string, string, WebhookHandler]> = [
  ['POST', '/api/v1/webhooks/stripe', handleStripeWebhook],
  ['POST', '/api/v1/webhooks/clerk', handleClerkWebhook],
];

// =============================================
// WORKER EXPORT
// =============================================

export default {
  /**
   * HTTP request handler — the main entry point.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    // ── CORS Preflight ──
    if (request.method === 'OPTIONS') {
      return handlePreflight(request, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ── Webhook Routes (no JWT auth) ──
      for (const [routeMethod, pattern, handler] of WEBHOOK_ROUTES) {
        if (method === routeMethod && path === pattern) {
          const webhookCtx = createWebhookContext(request, env);
          const response = await handler(request, webhookCtx);
          return addCorsHeaders(response, request, env);
        }
      }

      // ── Health Check ──
      if (path === '/api/v1/health' && method === 'GET') {
        const response = new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
          headers: { 'Content-Type': 'application/json' },
        });
        return addCorsHeaders(response, request, env);
      }

      // ── Public Verification (no auth — Feature 10) ──
      if (path.startsWith('/api/v1/verify/') && method === 'GET') {
        const response = await verifyBundle(request, env);
        return addCorsHeaders(response, request, env);
      }

      // ── Authenticated Routes ──
      for (const [routeMethod, pattern, handler] of ROUTES) {
        if (method !== routeMethod) continue;

        const params = matchRoute(pattern, path);
        if (params === null) continue;

        // Authenticate and build context
        const ctx = await guard(request, env);

        // Route matched — execute handler
        const response = await handler(request, params, ctx);

        // Log request completion
        const latencyMs = Date.now() - ctx.startedAt;
        const logger = Logger.fromContext(ctx);
        logger.info('Request completed', {
          status: response.status,
          latencyMs,
        });

        return addCorsHeaders(response, request, env);
      }

      // ── 404 Not Found ──
      const notFoundResponse = new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `No route found for ${method} ${path}`,
            requestId: crypto.randomUUID(),
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
      return addCorsHeaders(notFoundResponse, request, env);

   } catch (error) {
      // ── Global Error Boundary ──
      const requestId = crypto.randomUUID();

      // Production error logging — surfaces in Cloudflare Observability
      console.error(JSON.stringify({
        level: 'error',
        requestId,
        method,
        path,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }));

      const errorResponse = formatErrorResponse(error, requestId);
      return addCorsHeaders(errorResponse, request, env);
    }
  },

  /**
   * Queue message handler — dispatches to the correct consumer.
   */
  async queue(batch: MessageBatch<QueueMessageBody>, env: Env): Promise<void> {
    // Determine queue from first message or queue name
    const firstMessage = batch.messages[0];
    if (!firstMessage) return;

    const messageType = firstMessage.body.type;

    switch (messageType) {
      case 'audio_transcription':
        await handleAudioQueue(batch, env);
        break;

      case 'pdf_generation':
        await handlePdfQueue(batch, env);
        break;

      default:
        // Unknown message type — ack all to prevent infinite redelivery
        for (const message of batch.messages) {
          message.ack();
        }
    }
  },
};

// =============================================
// ROUTE MATCHING
// =============================================

/**
 * Match a route pattern against a URL path.
 * Returns extracted params or null if no match.
 *
 * Pattern: '/api/v1/sites/:id'
 * Path:    '/api/v1/sites/abc-123'
 * Result:  { id: 'abc-123' }
 */
function matchRoute(pattern: string, path: string): RouteParams | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  // Must have same number of segments
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i] ?? '';
    const pathPart = pathParts[i] ?? '';

    if (patternPart.startsWith(':')) {
      // Parameter segment — capture value
      const paramName = patternPart.slice(1);
      if (!pathPart) return null; // Empty param value
      params[paramName] = pathPart;
    } else if (patternPart !== pathPart) {
      // Static segment mismatch
      return null;
    }
  }

  return params;
}
