/**
 * InspectVoice — Uploads Route Handler
 * R2 file upload endpoints for photos and audio recordings.
 *
 * Endpoints:
 *   POST   /api/v1/uploads/photo                    — Request photo upload URL
 *   POST   /api/v1/uploads/audio                    — Request audio upload URL
 *   PUT    /api/v1/uploads/put/:r2Key               — Proxy upload to R2
 *   POST   /api/v1/uploads/photo/:r2Key/confirm     — Confirm photo upload
 *   POST   /api/v1/uploads/audio/:r2Key/confirm     — Confirm audio upload → triggers AI pipeline
 *   GET    /api/v1/files/:r2Key                     — Download file from R2
 *
 * Upload flow (matches syncService.ts exactly):
 *   1. Frontend POSTs to /uploads/photo or /uploads/audio → gets upload_url + r2_key
 *   2. Frontend PUTs file data to the upload_url
 *   3. Frontend POSTs to /uploads/{type}/{r2Key}/confirm
 *   4. For audio: confirmation enqueues Deepgram→Claude processing
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, RouteParams, QueueMessageBody } from '../types';
import { createR2, validateUploadToken } from '../services/r2';
import { createDb } from '../services/db';
import { writeAuditLog } from '../services/audit';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { BadRequestError, NotFoundError } from '../shared/errors';
import { Logger } from '../shared/logger';
import {
  parseJsonBody,
  validateUUID,
  validateString,
  validateOptionalString,
  validateOptionalNumber,
  validateOptionalLatitude,
  validateOptionalLongitude,
  validateOptionalISODate,
  validateOptionalBoolean,
} from '../shared/validation';
import { jsonResponse, acceptedResponse, fileResponse } from './helpers';

// =============================================
// REQUEST PHOTO UPLOAD URL
// =============================================

export async function requestPhotoUpload(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'upload');

  const body = await parseJsonBody(request);
  const r2 = createR2(ctx);

  const inspectionItemId = validateUUID(body['inspection_item_id'], 'inspection_item_id');
  const mimeType = validateString(body['mime_type'], 'mime_type', { maxLength: 50 });
  const fileSizeBytes = validateOptionalNumber(body['file_size_bytes'], 'file_size_bytes', { min: 1, max: 10 * 1024 * 1024, integer: true }) ?? 0;

  const uploadUrl = await r2.createPhotoUploadUrl(
    inspectionItemId,
    mimeType,
    fileSizeBytes,
  );

  return jsonResponse({
    success: true,
    data: uploadUrl,
  }, ctx.requestId);
}

// =============================================
// REQUEST AUDIO UPLOAD URL
// =============================================

export async function requestAudioUpload(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'upload');

  const body = await parseJsonBody(request);
  const r2 = createR2(ctx);

  const inspectionItemId = validateUUID(body['inspection_item_id'], 'inspection_item_id');
  const mimeType = validateString(body['mime_type'], 'mime_type', { maxLength: 100 });

  const uploadUrl = await r2.createAudioUploadUrl(inspectionItemId, mimeType);

  return jsonResponse({
    success: true,
    data: uploadUrl,
  }, ctx.requestId);
}

// =============================================
// PROXY UPLOAD TO R2
// =============================================

/**
 * Receives the actual file data and writes it to R2.
 * The frontend PUTs to this endpoint with the raw file body.
 * Validates the upload token from the query string.
 */
export async function proxyUploadToR2(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'upload');

  const r2Key = decodeURIComponent(params['r2Key'] ?? '');
  if (!r2Key) {
    throw new BadRequestError('Missing r2Key');
  }

  // Validate upload token from query string
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) {
    throw new BadRequestError('Missing upload token');
  }

  const isValid = await validateUploadToken(r2Key, token);
  if (!isValid) {
    throw new BadRequestError('Invalid or expired upload token');
  }

  // Read the request body as ArrayBuffer
  const contentType = request.headers.get('Content-Type') ?? 'application/octet-stream';
  const body = await request.arrayBuffer();

  if (!body || body.byteLength === 0) {
    throw new BadRequestError('Empty upload body');
  }

  const r2 = createR2(ctx);
  await r2.put(r2Key, body, { contentType });

  const logger = Logger.fromContext(ctx);
  logger.info('File uploaded to R2', {
    r2Key,
    sizeBytes: body.byteLength,
    contentType,
  });

  return jsonResponse({
    success: true,
    data: { r2_key: r2Key },
  }, ctx.requestId);
}

// =============================================
// CONFIRM PHOTO UPLOAD
// =============================================

/**
 * Confirms a photo was uploaded to R2 and creates the DB record.
 * Called by syncService after photo upload completes.
 */
export async function confirmPhotoUpload(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const r2Key = decodeURIComponent(params['r2Key'] ?? '');
  if (!r2Key) throw new BadRequestError('Missing r2Key');

  const body = await parseJsonBody(request);
  const r2 = createR2(ctx);
  const db = createDb(ctx);

  // Verify the file exists in R2
  const exists = await r2.exists(r2Key);
  if (!exists) {
    throw new NotFoundError('File not found in storage — upload may have failed');
  }

  // Validate confirmation data
  const inspectionItemId = validateUUID(body['inspection_item_id'], 'inspection_item_id');
  const assetId = body['asset_id'] ? validateUUID(body['asset_id'], 'asset_id') : null;
  const capturedAt = validateOptionalISODate(body['captured_at'], 'captured_at') ?? new Date().toISOString();
  const latitude = validateOptionalLatitude(body['latitude'], 'latitude');
  const longitude = validateOptionalLongitude(body['longitude'], 'longitude');
  const caption = validateOptionalString(body['caption'], 'caption', { maxLength: 500 });
  const isReferencePhoto = validateOptionalBoolean(body['is_reference_photo'], 'is_reference_photo', false);

  // Insert photo record
  const photoData: Record<string, unknown> = {
    id: crypto.randomUUID(),
    inspection_item_id: inspectionItemId,
    r2_key: r2Key,
    r2_url: `/api/v1/files/${encodeURIComponent(r2Key)}`,
    thumbnail_r2_key: null,
    thumbnail_r2_url: null,
    file_size_bytes: null,
    mime_type: null,
    width: null,
    height: null,
    latitude,
    longitude,
    captured_at: capturedAt,
    caption,
    is_primary: false,
    is_reference_photo: isReferencePhoto,
    photo_type: isReferencePhoto ? 'reference' : 'defect',
    metadata: {},
    created_at: new Date().toISOString(),
  };

  // Insert (raw — photos doesn't have org_id, verified through inspection chain)
  const columns = Object.keys(photoData);
  const values = Object.values(photoData);
  const placeholders = columns.map((_, i) => `$${i + 1}`);

  await db.rawQuery(
    `INSERT INTO photos (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    values,
  );

  // Update asset reference photo if this is a reference photo
  if (isReferencePhoto && assetId) {
    await db.rawQuery(
      `UPDATE assets SET reference_photo_id = $1, updated_at = $2
       WHERE id = $3 AND site_id IN (SELECT id FROM sites WHERE org_id = $4)`,
      [photoData['id'], new Date().toISOString(), assetId, ctx.orgId],
    );
  }

  void writeAuditLog(ctx, 'photo.uploaded', 'photos', photoData['id'] as string, {
    inspection_item_id: inspectionItemId,
    r2_key: r2Key,
    is_reference_photo: isReferencePhoto,
  }, request);

  return jsonResponse({
    success: true,
    data: { id: photoData['id'], r2_key: r2Key },
  }, ctx.requestId);
}

// =============================================
// CONFIRM AUDIO UPLOAD → TRIGGER AI PIPELINE
// =============================================

/**
 * Confirms an audio recording was uploaded to R2,
 * updates the inspection item, and enqueues the AI processing pipeline.
 *
 * This is the trigger for: Audio → Deepgram → Claude → Structured defect data
 */
export async function confirmAudioUpload(
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');

  const r2Key = decodeURIComponent(params['r2Key'] ?? '');
  if (!r2Key) throw new BadRequestError('Missing r2Key');

  const body = await parseJsonBody(request);
  const r2 = createR2(ctx);
  const db = createDb(ctx);
  const logger = Logger.fromContext(ctx);

  // Verify file exists
  const exists = await r2.exists(r2Key);
  if (!exists) {
    throw new NotFoundError('Audio file not found in storage');
  }

  // Validate confirmation data (matches syncService.ts payload exactly)
  const inspectionItemId = validateUUID(body['inspection_item_id'], 'inspection_item_id');
  const assetId = validateUUID(body['asset_id'], 'asset_id');
  const assetCode = validateString(body['asset_code'], 'asset_code', { maxLength: 50 });
  const assetType = validateString(body['asset_type'], 'asset_type', { maxLength: 50 });
  const durationSeconds = validateOptionalNumber(body['duration_seconds'], 'duration_seconds', { min: 0, max: 3600 }) ?? 0;
  const timestamp = validateOptionalISODate(body['timestamp'], 'timestamp') ?? new Date().toISOString();

  // Update inspection item with audio R2 key and set AI status to pending
  await db.rawQuery(
    `UPDATE inspection_items
     SET audio_r2_key = $1, ai_processing_status = 'pending'
     WHERE id = $2
     AND inspection_id IN (SELECT id FROM inspections WHERE org_id = $3)`,
    [r2Key, inspectionItemId, ctx.orgId],
  );

  // Enqueue for AI processing: Deepgram transcription → Claude analysis
  const queueMessage: QueueMessageBody = {
    type: 'audio_transcription',
    requestId: ctx.requestId,
    orgId: ctx.orgId,
    userId: ctx.userId,
    payload: {
      r2Key,
      inspectionItemId,
      assetId,
      assetCode,
      assetType,
      mimeType: request.headers.get('Content-Type') ?? 'audio/webm',
      durationSeconds,
    },
    enqueuedAt: new Date().toISOString(),
  };

  try {
    await ctx.env.AUDIO_PROCESSING_QUEUE.send(queueMessage);

    logger.info('Audio enqueued for AI processing', {
      inspectionItemId,
      assetId,
      assetCode,
      assetType,
      r2Key,
      durationSeconds,
    });
  } catch (error) {
    // Queue failure — don't fail the upload, but log at ERROR level
    logger.error('Failed to enqueue audio for processing', error, {
      inspectionItemId,
      r2Key,
    });

    // Mark as failed so the frontend can show the user
    await db.rawQuery(
      `UPDATE inspection_items SET ai_processing_status = 'failed'
       WHERE id = $1
       AND inspection_id IN (SELECT id FROM inspections WHERE org_id = $2)`,
      [inspectionItemId, ctx.orgId],
    );
  }

  void writeAuditLog(ctx, 'audio.uploaded', 'inspection_items', inspectionItemId, {
    r2_key: r2Key,
    asset_id: assetId,
    asset_code: assetCode,
    duration_seconds: durationSeconds,
  }, request);

  return acceptedResponse({
    success: true,
    data: {
      r2_key: r2Key,
      ai_processing_status: 'pending',
      message: 'Audio uploaded. Transcription and AI analysis queued.',
    },
  }, ctx.requestId);
}

// =============================================
// FILE DOWNLOAD
// =============================================

/**
 * Download a file from R2.
 * Used for photos and generated PDFs.
 */
export async function downloadFile(
  _request: Request,
  params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');

  const r2Key = decodeURIComponent(params['r2Key'] ?? '');
  if (!r2Key) throw new BadRequestError('Missing file key');

  const r2 = createR2(ctx);
  const object = await r2.get(r2Key);

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';

  return fileResponse(
    object.body,
    ctx.requestId,
    {
      contentType,
      contentLength: object.size,
    },
  );
}
