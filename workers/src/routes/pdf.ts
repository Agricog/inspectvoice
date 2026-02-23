/**
 * InspectVoice — PDF Route Handler
 * Endpoints for triggering PDF generation and downloading reports.
 *
 * Endpoints:
 *   POST   /api/v1/inspections/:id/pdf  — Trigger PDF generation (async via queue)
 *   GET    /api/v1/inspections/:id/pdf   — Download generated PDF
 *
 * PDF generation is async — the POST enqueues a job and returns 202 Accepted.
 * The frontend polls GET until pdf_url is populated on the inspection.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams, QueueMessageBody } from '../types';
import { createDb } from '../services/db';
import { createR2 } from '../services/r2';
import { writeAuditLog } from '../services/audit';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { NotFoundError, BadRequestError, ConflictError } from '../shared/errors';
import { Logger } from '../shared/logger';
import { validateUUID } from '../shared/validation';
import { jsonResponse, acceptedResponse, fileResponse } from './helpers';

// =============================================
// TRIGGER PDF GENERATION
// =============================================

/**
 * Enqueue PDF generation for an inspection.
 * Returns 202 Accepted — frontend should poll the inspection endpoint
 * until pdf_url is populated.
 */
export async function triggerPdfGeneration(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);
  const logger = Logger.fromContext(ctx);

  // Verify inspection exists and belongs to this org
  const inspection = await db.findByIdOrThrow<Record<string, unknown>>('inspections', id, 'Inspection');
  const status = inspection['status'] as string;

  // Only allow PDF generation for review/signed/exported inspections
  if (status === 'draft') {
    throw new BadRequestError(
      'Cannot generate PDF for a draft inspection. Please move to review status first.',
    );
  }

  // Check if PDF already exists (allow regeneration with query param)
  const url = new URL(request.url);
  const regenerate = url.searchParams.get('regenerate') === 'true';

  if (inspection['pdf_generated_at'] && !regenerate) {
    return jsonResponse({
      success: true,
      data: {
        pdf_url: inspection['pdf_url'],
        pdf_generated_at: inspection['pdf_generated_at'],
        status: 'completed',
      },
    }, ctx.requestId);
  }

  // Enqueue PDF generation
  const queueMessage: QueueMessageBody = {
    type: 'pdf_generation',
    requestId: ctx.requestId,
    orgId: ctx.orgId,
    userId: ctx.userId,
    payload: {
      inspectionId: id,
    },
    enqueuedAt: new Date().toISOString(),
  };

  try {
    await ctx.env.PDF_GENERATION_QUEUE.send(queueMessage);

    logger.info('PDF generation enqueued', { inspectionId: id });
  } catch (error) {
    logger.error('Failed to enqueue PDF generation', error, { inspectionId: id });
    throw new BadRequestError('Failed to start PDF generation. Please try again.');
  }

  void writeAuditLog(ctx, 'inspection.exported', 'inspections', id, null, request);

  return acceptedResponse({
    success: true,
    data: {
      status: 'generating',
      message: 'PDF generation started. Poll the inspection endpoint for pdf_url.',
    },
  }, ctx.requestId);
}

// =============================================
// DOWNLOAD PDF
// =============================================

/**
 * Download the generated PDF for an inspection.
 * Returns the PDF file if it exists, or status information if not yet generated.
 */
export async function downloadPdf(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const id = validateUUID(params['id'], 'id');
  const db = createDb(ctx);

  // Fetch inspection with site name for filename
  const rows = await db.rawQuery(
    `SELECT i.pdf_url, i.pdf_generated_at, i.inspection_date, s.name AS site_name
     FROM inspections i
     INNER JOIN sites s ON s.id = i.site_id
     WHERE i.id = $1`,
    [id],
  );

  const inspection = (rows as Record<string, unknown>[])[0];
  if (!inspection) {
    throw new NotFoundError('Inspection not found');
  }

  const pdfUrl = inspection['pdf_url'] as string | null;

  if (!pdfUrl) {
    return jsonResponse({
      success: true,
      data: {
        status: inspection['pdf_generated_at'] === null ? 'not_generated' : 'generating',
        message: 'PDF not yet available.',
      },
    }, ctx.requestId);
  }

  // Extract R2 key from the URL path
  const r2Key = decodeURIComponent(pdfUrl.replace('/api/v1/files/', ''));

  const r2 = createR2(ctx);
  const object = await r2.get(r2Key);

  // Build human-readable filename
  const siteName = ((inspection['site_name'] as string) ?? 'Site')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  const date = ((inspection['inspection_date'] as string) ?? '').slice(0, 10);
  const ref = id.slice(0, 8).toUpperCase();
  const filename = `InspectVoice-${ref}-${siteName}-${date}.pdf`;

  return fileResponse(
    object.body,
    ctx.requestId,
    {
      contentType: 'application/pdf',
      filename,
      contentLength: object.size,
    },
  );
}
