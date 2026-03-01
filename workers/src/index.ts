/**
 * InspectVoice — Cloudflare Worker Entry Point
 * Routes all HTTP requests and queue messages to their handlers.
 *
 * UPDATED: Feature 16 Batch 16.5 — magic link CRUD + resource resolution.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { Env, QueueMessageBody, RouteHandler, RouteParams, WebhookHandler, PortalRequestContext } from './types';
import { guard, createWebhookContext } from './middleware/guard';
import { portalGuard, verifyMagicLink } from './middleware/portalGuard';
import { handlePreflight, addCorsHeaders } from './middleware/cors';
import { formatErrorResponse } from './shared/errors';
import { Logger } from './shared/logger';

// ── Route Handlers ──
import { listSites, getSite, createSite, updateSite, deleteSite } from './routes/sites';
import { runCompletenessCheck } from './routes/completenessCheck';
import { listAssetsBySite, getAsset, createAsset, updateAsset } from './routes/assets';
import { getAssetHistory } from './routes/assetHistory';
import { listInspections, getInspection, createInspection, updateInspection, deleteInspection } from './routes/inspections';
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

// ── Notifications ──
import {
  listNotificationRecipients,
  getNotificationRecipient,
  createNotificationRecipient,
  updateNotificationRecipient,
  deactivateNotificationRecipient,
  listNotificationLog,
} from './routes/notifications';
import { handleSummaryEmailCron } from './cron/summaryEmail';

// ── Route Planner ──
import { getRoutePlannerSites, optimiseRoute, getDirections } from './routes/routePlanner';

// ── Normalisation ──
import {
  normaliseFieldEndpoint,
  normaliseBatchEndpoint,
  acceptNormalisationEndpoint,
  rejectNormalisationEndpoint,
  listNormalisationHistory,
  getNormalisationUsage,
} from './routes/normalise';

// ── Feature 14: Inspector Performance ──
import {
  getPerformanceOverview,
  getPerformanceDetail,
  getMyPerformance,
  getMyPerformanceTrends,
  getPerformanceBenchmarks,
  createPerformanceShareLink,
  resolvePerformanceShareLink,
} from './routes/inspectorPerformance';
import { computeInspectorMetrics } from './cron/metricsComputation';

// ── Feature 15: Defect Library ──
import {
  listDefectLibrary,
  quickPickDefects,
  getDefectLibraryEntry,
  getDefectLibraryVersions,
  createDefectLibraryEntry,
  updateDefectLibraryEntry,
  deleteDefectLibraryEntry,
  recordLibraryUsage,
  seedDefectLibrary,
} from './routes/defectLibrary';

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

// ── Feature 16: Client Portal (Portal-Side — client users) ──
import {
  portalDashboard,
  portalListSites,
  portalGetSite,
  portalListInspections,
  portalGetInspection,
  portalListDefects,
  portalGetDefect,
  portalCreateDefectUpdate,
  portalListNotifications,
  portalMarkNotificationsRead,
} from './routes/portal';

// ── Feature 16: Magic Links ──
import {
  createMagicLink,
  listMagicLinks,
  revokeMagicLink,
  resolveMagicLinkResource,
} from './routes/magicLinks';

// ── Webhook Handlers ──
import { handleStripeWebhook } from './routes/webhooks/stripe';
import { handleClerkWebhook } from './routes/webhooks/clerk';

// ── Queue Consumers ──
import { handleAudioQueue } from './queues/audioProcessor';
import { handlePdfQueue } from './queues/pdfGenerator';

// =============================================
// ROUTE TABLE (Inspector Platform — uses guard)
// =============================================

const ROUTES: Array<[string, string, RouteHandler]> = [
  // ── Sites ──
  ['GET', '/api/v1/sites', listSites],
  ['GET', '/api/v1/sites/:id', getSite],
  ['POST', '/api/v1/sites', createSite],
  ['PUT', '/api/v1/sites/:id', updateSite],
  ['DELETE', '/api/v1/sites/:id', deleteSite],

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
  ['DELETE', '/api/v1/inspections/:id', deleteInspection],

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

  // ── Completeness Check ──
  ['POST', '/api/v1/inspections/:id/completeness-check', runCompletenessCheck],

  // ── Users ──
  ['GET', '/api/v1/users/me', getMe],
  ['PUT', '/api/v1/users/me', updateMe],

  // ── Organisation ──
  ['GET', '/api/v1/org/settings', getOrgSettings],
  ['PUT', '/api/v1/org/settings', updateOrgSettings],

  // ── Dashboard ──
  ['GET', '/api/v1/dashboard/stats', getDashboardStats],

  // ── Notifications ──
  ['GET',    '/api/v1/notifications/recipients', listNotificationRecipients],
  ['GET',    '/api/v1/notifications/recipients/:id', getNotificationRecipient],
  ['POST',   '/api/v1/notifications/recipients', createNotificationRecipient],
  ['PUT',    '/api/v1/notifications/recipients/:id', updateNotificationRecipient],
  ['DELETE', '/api/v1/notifications/recipients/:id', deactivateNotificationRecipient],
  ['GET',    '/api/v1/notifications/log', listNotificationLog],

  // ── Route Planner (Feature 13) ──
  ['GET',  '/api/v1/route-planner/sites', getRoutePlannerSites],
  ['POST', '/api/v1/route-planner/optimise', optimiseRoute],
  ['POST', '/api/v1/route-planner/directions', getDirections],

  // ── Normalisation ──
  ['POST',   '/api/v1/normalise/field', normaliseFieldEndpoint],
  ['POST',   '/api/v1/normalise/batch', normaliseBatchEndpoint],
  ['POST',   '/api/v1/normalise/:id/accept', acceptNormalisationEndpoint],
  ['POST',   '/api/v1/normalise/:id/reject', rejectNormalisationEndpoint],
  ['GET',    '/api/v1/normalise/history', listNormalisationHistory],
  ['GET',    '/api/v1/normalise/usage', getNormalisationUsage],

  // ── Sealed Exports (Feature 10) ──
  ['POST', '/api/v1/sealed-exports/defects', createSealedDefectExport],
  ['POST', '/api/v1/sealed-exports/inspections/:id/pdf', createSealedPdfExport],
  ['POST', '/api/v1/sealed-exports/incidents/:id/claims-pack', createSealedClaimsPack],
  ['GET',  '/api/v1/sealed-exports/:bundleId/download', downloadSealedExport],
  ['GET',  '/api/v1/sealed-exports', listSealedExports],

  // ── Feature 14: Inspector Performance ──
  ['GET',  '/api/v1/inspector-performance/benchmarks', getPerformanceBenchmarks],
  ['GET',  '/api/v1/inspector-performance/:userId', getPerformanceDetail],
  ['POST', '/api/v1/inspector-performance/:userId/share', createPerformanceShareLink],
  ['GET',  '/api/v1/inspector-performance', getPerformanceOverview],
  ['GET',  '/api/v1/my-performance/trends', getMyPerformanceTrends],
  ['GET',  '/api/v1/my-performance', getMyPerformance],
  ['GET',  '/api/v1/performance-share/:token', resolvePerformanceShareLink],

  // ── Feature 15: Defect Library ──
  ['GET',    '/api/v1/defect-library/quick-pick/:assetType', quickPickDefects],
  ['GET',    '/api/v1/defect-library/:id/versions', getDefectLibraryVersions],
  ['POST',   '/api/v1/defect-library/:id/record-usage', recordLibraryUsage],
  ['GET',    '/api/v1/defect-library/:id', getDefectLibraryEntry],
  ['POST',   '/api/v1/defect-library/seed', seedDefectLibrary],
  ['POST',   '/api/v1/defect-library', createDefectLibraryEntry],
  ['PUT',    '/api/v1/defect-library/:id', updateDefectLibraryEntry],
  ['DELETE', '/api/v1/defect-library/:id', deleteDefectLibraryEntry],
  ['GET',    '/api/v1/defect-library', listDefectLibrary],

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

  // ── Feature 16: Magic Links (Inspector-Side) ──
  ['POST',   '/api/v1/magic-links', createMagicLink],
  ['GET',    '/api/v1/magic-links', listMagicLinks],
  ['DELETE', '/api/v1/magic-links/:id', revokeMagicLink],
];

// =============================================
// PORTAL ROUTE TABLE (Client Portal — uses portalGuard)
// =============================================

type PortalRouteEntry = [string, string, (request: Request, params: RouteParams, ctx: PortalRequestContext) => Promise<Response>];

const PORTAL_ROUTES: PortalRouteEntry[] = [
  ['GET',  '/api/v1/portal/dashboard', portalDashboard],
  ['GET',  '/api/v1/portal/sites', portalListSites],
  ['GET',  '/api/v1/portal/sites/:id', portalGetSite],
  ['GET',  '/api/v1/portal/inspections', portalListInspections],
  ['GET',  '/api/v1/portal/inspections/:id', portalGetInspection],
  ['GET',  '/api/v1/portal/defects', portalListDefects],
  ['GET',  '/api/v1/portal/defects/:id', portalGetDefect],
  ['POST', '/api/v1/portal/defects/:id/update', portalCreateDefectUpdate],
  ['GET',  '/api/v1/portal/notifications', portalListNotifications],
  ['POST', '/api/v1/portal/notifications/read', portalMarkNotificationsRead],
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
  async fetch(request: Request, env: Env): Promise<Response> {
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

      // ── Magic Link Routes (no auth — Feature 16) ──
      if (path.startsWith('/api/v1/portal/magic/') && method === 'GET') {
        const tokenMatch = path.match(/^\/api\/v1\/portal\/magic\/([a-zA-Z0-9_-]+)$/);
        if (tokenMatch && tokenMatch[1]) {
          const magicToken = tokenMatch[1];
          const magicCtx = await verifyMagicLink(request, magicToken, env);
          const response = await resolveMagicLinkResource(request, magicCtx);
          return addCorsHeaders(response, request, env);
        }
      }

      // ── Portal Routes (client auth — Feature 16) ──
      if (path.startsWith('/api/v1/portal/') && !path.startsWith('/api/v1/portal/magic/')) {
        for (const [routeMethod, pattern, handler] of PORTAL_ROUTES) {
          if (method !== routeMethod) continue;

          const params = matchRoute(pattern, path);
          if (params === null) continue;

          const portalCtx = await portalGuard(request, env);
          const response = await handler(request, params, portalCtx);
          return addCorsHeaders(response, request, env);
        }
      }

      // ── Authenticated Routes (Inspector Platform) ──
      for (const [routeMethod, pattern, handler] of ROUTES) {
        if (method !== routeMethod) continue;

        const params = matchRoute(pattern, path);
        if (params === null) continue;

        const ctx = await guard(request, env);
        const response = await handler(request, params, ctx);

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
      const requestId = crypto.randomUUID();

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

  async queue(batch: MessageBatch<QueueMessageBody>, env: Env): Promise<void> {
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
        for (const message of batch.messages) {
          message.ack();
        }
    }
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const cronPattern = controller.cron;

    if (cronPattern === '0 3 * * *') {
      ctx.waitUntil(computeInspectorMetrics(env));
    } else {
      ctx.waitUntil(handleSummaryEmailCron(env));
    }
  },
};

// =============================================
// ROUTE MATCHING
// =============================================

function matchRoute(pattern: string, path: string): RouteParams | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i] ?? '';
    const pathPart = pathParts[i] ?? '';

    if (patternPart.startsWith(':')) {
      const paramName = patternPart.slice(1);
      if (!pathPart) return null;
      params[paramName] = pathPart;
    } else if (patternPart !== pathPart) {
      return null;
    }
  }

  return params;
}
