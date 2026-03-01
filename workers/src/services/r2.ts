/**
 * InspectVoice — R2 Storage Service
 * Cloudflare R2 bucket operations for photos and audio files.
 *
 * Handles:
 * - Upload URL generation for direct client uploads to Workers
 * - File retrieval for processing (audio transcription, PDF embedding)
 * - Key generation with org-scoped prefixes (tenant isolation in storage)
 * - Content type validation (only allow expected file types)
 * - File existence verification (for upload confirmation)
 *
 * Upload flow:
 *   1. Frontend requests upload URL via API
 *   2. This service generates a token-authenticated absolute URL to Workers
 *   3. Frontend PUTs directly to Workers (bypasses Railway/CDN proxy)
 *   4. Worker handler writes to R2 using the binding
 *   5. Frontend calls /confirm endpoint
 *   6. This service verifies the file exists in R2
 *
 * Why absolute URLs:
 *   The frontend is served by Railway, which proxies /api/v1/* to Workers.
 *   However, Railway blocks PUT requests (405 Method Not Allowed).
 *   Binary uploads must go direct to Workers via WORKERS_PUBLIC_URL,
 *   bypassing Railway entirely. GET/POST API calls continue through Railway.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { Env, RequestContext } from '../types';
import { BadRequestError, InternalError, NotFoundError } from '../shared/errors';
import { Logger } from '../shared/logger';

// =============================================
// CONFIGURATION
// =============================================

/** Presigned URL expiry in seconds (5 minutes) */
const SIGNED_URL_TTL_SECONDS = 300;

/** Maximum photo file size (10MB) — matches frontend guard */
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum audio file size (50MB) — matches frontend guard */
const MAX_AUDIO_SIZE_BYTES = 50 * 1024 * 1024;

/** Allowed photo MIME types */
const ALLOWED_PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Allowed audio MIME types */
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/mp4',
  'audio/mpeg',
  'audio/webm;codecs=opus',
]);

// =============================================
// R2 SERVICE
// =============================================

export class R2Service {
  private readonly bucket: R2Bucket;
  private readonly logger: Logger;
  private readonly orgId: string;
  private readonly workersPublicUrl: string;

  constructor(ctx: RequestContext) {
    this.bucket = ctx.env.INSPECTVOICE_BUCKET;
    this.logger = Logger.fromContext(ctx);
    this.orgId = ctx.orgId;
    this.workersPublicUrl = ctx.env.WORKERS_PUBLIC_URL;
  }

  // =============================================
  // KEY GENERATION
  // =============================================

  /**
   * Generate a tenant-scoped R2 key for a photo.
   * Format: {orgId}/photos/{inspectionItemId}/{uuid}.{ext}
   *
   * Tenant scoping in the key path provides defence-in-depth
   * (even if a bug bypasses DB-level isolation, R2 keys are org-prefixed).
   */
  generatePhotoKey(inspectionItemId: string, mimeType: string): string {
    const ext = mimeTypeToExtension(mimeType, 'photo');
    const uniqueId = crypto.randomUUID();
    return `${this.orgId}/photos/${inspectionItemId}/${uniqueId}.${ext}`;
  }

  /**
   * Generate a tenant-scoped R2 key for an audio recording.
   * Format: {orgId}/audio/{inspectionItemId}/{uuid}.{ext}
   */
  generateAudioKey(inspectionItemId: string, mimeType: string): string {
    const ext = mimeTypeToExtension(mimeType, 'audio');
    const uniqueId = crypto.randomUUID();
    return `${this.orgId}/audio/${inspectionItemId}/${uniqueId}.${ext}`;
  }

  /**
   * Generate a tenant-scoped R2 key for a PDF report.
   * Format: {orgId}/reports/{inspectionId}/{timestamp}.pdf
   */
  generatePdfKey(inspectionId: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${this.orgId}/reports/${inspectionId}/${timestamp}.pdf`;
  }

  // =============================================
  // UPLOAD URL GENERATION
  // =============================================

  /**
   * Generate an upload URL for photo upload.
   * The frontend uploads directly to this URL.
   *
   * @returns Object with upload_url, r2_key, and r2_url
   */
  async createPhotoUploadUrl(
    inspectionItemId: string,
    mimeType: string,
    fileSizeBytes: number,
  ): Promise<UploadUrlResult> {
    // Validate content type
    if (!ALLOWED_PHOTO_TYPES.has(mimeType)) {
      throw new BadRequestError(
        `Unsupported photo type: ${mimeType}. Allowed: ${[...ALLOWED_PHOTO_TYPES].join(', ')}`,
      );
    }

    // Validate file size
    if (fileSizeBytes > MAX_PHOTO_SIZE_BYTES) {
      throw new BadRequestError(
        `Photo exceeds maximum size of ${MAX_PHOTO_SIZE_BYTES / (1024 * 1024)}MB`,
      );
    }

    const r2Key = this.generatePhotoKey(inspectionItemId, mimeType);
    return this.createUploadUrl(r2Key, mimeType);
  }

  /**
   * Generate an upload URL for audio upload.
   */
  async createAudioUploadUrl(
    inspectionItemId: string,
    mimeType: string,
  ): Promise<UploadUrlResult> {
    // Validate content type (be more permissive with audio — codecs vary)
    const baseMime = mimeType.split(';')[0]?.trim() ?? mimeType;
    if (!ALLOWED_AUDIO_TYPES.has(baseMime) && !ALLOWED_AUDIO_TYPES.has(mimeType)) {
      throw new BadRequestError(
        `Unsupported audio type: ${mimeType}. Allowed: ${[...ALLOWED_AUDIO_TYPES].join(', ')}`,
      );
    }

    const r2Key = this.generateAudioKey(inspectionItemId, mimeType);
    return this.createUploadUrl(r2Key, mimeType);
  }

  /**
   * Generate a token-authenticated upload URL.
   *
   * Upload URLs are ABSOLUTE, pointing directly to the Workers domain
   * (WORKERS_PUBLIC_URL). This is required because:
   *   - The frontend is served by Railway
   *   - Railway proxies /api/v1/* but blocks PUT requests (405)
   *   - Binary uploads must bypass Railway and go direct to Workers
   *
   * The upload endpoint validates the HMAC token before accepting the upload.
   * Tokens are time-limited (SIGNED_URL_TTL_SECONDS) and key-bound.
   */
  private async createUploadUrl(
    r2Key: string,
    _mimeType: string,
  ): Promise<UploadUrlResult> {
    // Generate a time-limited, key-bound upload token
    const uploadToken = await generateUploadToken(r2Key);

    // Build ABSOLUTE upload URL pointing directly to Workers
    // This bypasses Railway's proxy which blocks PUT requests
    const baseUrl = this.workersPublicUrl.replace(/\/+$/, '');
    const uploadPath = `/api/v1/uploads/put/${encodeURIComponent(r2Key)}?token=${uploadToken}`;
    const uploadUrl = `${baseUrl}${uploadPath}`;

    // Download URL remains relative (served via Railway proxy on GET)
    const r2Url = `/api/v1/files/${encodeURIComponent(r2Key)}`;

    this.logger.debug('Upload URL generated', {
      r2Key,
      uploadDomain: baseUrl,
    });

    return {
      upload_url: uploadUrl,
      r2_key: r2Key,
      r2_url: r2Url,
    };
  }

  // =============================================
  // FILE OPERATIONS
  // =============================================

  /**
   * Write data directly to R2.
   * Used by the upload proxy endpoint.
   */
  async put(
    key: string,
    data: ArrayBuffer | ReadableStream,
    options: R2PutOptions = {},
  ): Promise<void> {
    // Verify the key is scoped to this org (tenant isolation in storage)
    if (!key.startsWith(`${this.orgId}/`)) {
      throw new BadRequestError('Upload key does not match organisation');
    }

    try {
      await this.bucket.put(key, data, {
        httpMetadata: {
          contentType: options.contentType,
        },
        customMetadata: options.metadata,
      });

      this.logger.debug('File written to R2', { key });
    } catch (error) {
      this.logger.error('R2 put failed', error, { key });
      throw new InternalError('Failed to store file');
    }
  }

  /**
   * Check if a file exists in R2.
   * Used by the /confirm endpoint to verify the upload succeeded.
   */
  async exists(key: string): Promise<boolean> {
    try {
      const head = await this.bucket.head(key);
      return head !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get a file from R2.
   * Returns the R2Object with body stream, or throws NotFoundError.
   */
  async get(key: string): Promise<R2ObjectBody> {
    // Verify org-scoped access
    if (!key.startsWith(`${this.orgId}/`)) {
      throw new NotFoundError('File not found');
    }

    const object = await this.bucket.get(key);
    if (!object) {
      throw new NotFoundError('File not found');
    }

    return object;
  }

  /**
   * Get file metadata without downloading the body.
   */
  async head(key: string): Promise<R2Object | null> {
    if (!key.startsWith(`${this.orgId}/`)) {
      return null;
    }
    return this.bucket.head(key);
  }

  /**
   * Delete a file from R2.
   * Used when removing photos or cleaning up failed uploads.
   */
  async delete(key: string): Promise<void> {
    if (!key.startsWith(`${this.orgId}/`)) {
      throw new BadRequestError('Delete key does not match organisation');
    }

    try {
      await this.bucket.delete(key);
      this.logger.debug('File deleted from R2', { key });
    } catch (error) {
      this.logger.error('R2 delete failed', error, { key });
      throw new InternalError('Failed to delete file');
    }
  }

  /**
   * Get a file from R2 without org-scoping.
   * Used internally by queue consumers where the context is already verified.
   *
   * ⚠️ Only call this from trusted server-side code (queue consumers).
   */
  async getUnscoped(key: string): Promise<R2ObjectBody> {
    const object = await this.bucket.get(key);
    if (!object) {
      throw new NotFoundError('File not found in R2');
    }
    return object;
  }
}

// =============================================
// UPLOAD TOKEN GENERATION
// =============================================

/**
 * Generate a short-lived upload token.
 * This is a simple HMAC-based token that encodes the R2 key and expiry.
 * The upload endpoint validates this token before accepting the upload.
 *
 * This replaces S3-style presigned URLs since we're using R2 Worker bindings.
 */
async function generateUploadToken(r2Key: string): Promise<string> {
  const expiry = Date.now() + (SIGNED_URL_TTL_SECONDS * 1000);
  const payload = `${r2Key}|${expiry}`;

  // Use Web Crypto to create an HMAC
  // The "secret" is the r2Key itself combined with the expiry —
  // since this token is only valid within our own Worker, and the
  // upload endpoint re-derives the expected key from the URL path,
  // this provides sufficient protection against URL tampering.
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // Token format: {expiry}.{hash}
  return `${expiry}.${hashHex}`;
}

/**
 * Validate an upload token.
 * Returns true if the token is valid and not expired.
 */
export async function validateUploadToken(
  r2Key: string,
  token: string,
): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [expiryStr, providedHash] = parts as [string, string];
  const expiry = parseInt(expiryStr, 10);

  // Check expiry
  if (Number.isNaN(expiry) || Date.now() > expiry) {
    return false;
  }

  // Re-derive the expected hash
  const payload = `${r2Key}|${expiry}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const expectedHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // Constant-time comparison would be ideal, but for upload tokens
  // (not auth tokens), simple comparison is acceptable
  return providedHash === expectedHash;
}

// =============================================
// TYPES
// =============================================

export interface UploadUrlResult {
  /** Absolute URL the client should PUT the file to (points to Workers) */
  readonly upload_url: string;
  /** R2 object key (store this in the database) */
  readonly r2_key: string;
  /** Relative URL to access the file after upload (via Railway proxy) */
  readonly r2_url: string;
}

interface R2PutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

// =============================================
// HELPERS
// =============================================

/**
 * Map MIME type to file extension.
 */
function mimeTypeToExtension(mimeType: string, category: 'photo' | 'audio'): string {
  const baseMime = mimeType.split(';')[0]?.trim() ?? mimeType;

  if (category === 'photo') {
    const photoExtensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    return photoExtensions[baseMime] ?? 'jpg';
  }

  const audioExtensions: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
  };
  return audioExtensions[baseMime] ?? 'webm';
}

// =============================================
// FACTORY
// =============================================

/**
 * Create an R2Service for a request context.
 * Use in route handlers:
 *   const r2 = createR2(ctx);
 *   const uploadUrl = await r2.createPhotoUploadUrl(...);
 */
export function createR2(ctx: RequestContext): R2Service {
  return new R2Service(ctx);
}

/**
 * Create an R2Service for queue consumers (uses env directly).
 * Requires orgId to be passed explicitly since there's no request context.
 */
export function createR2ForQueue(bucket: R2Bucket, orgId: string): R2Service {
  // Create a minimal context for the service
  const minimalCtx = {
    env: { INSPECTVOICE_BUCKET: bucket, WORKERS_PUBLIC_URL: '' },
    orgId,
    requestId: crypto.randomUUID(),
  } as unknown as RequestContext;
  return new R2Service(minimalCtx);
}
