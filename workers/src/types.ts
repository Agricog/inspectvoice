/**
 * InspectVoice — Worker Type Definitions
 * workers/src/types.ts
 *
 * Central type definitions for the Cloudflare Worker.
 * All interfaces used across routes, middleware, and services.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

// =============================================
// ENVIRONMENT BINDINGS
// =============================================

/**
 * Cloudflare Worker environment bindings.
 * Secrets are encrypted at rest, plaintext vars are visible in dashboard.
 */
export interface Env {
  // ── Secrets ──
  readonly ANTHROPIC_API_KEY: string;
  readonly CLERK_JWKS_URL: string;
  readonly CLERK_SECRET_KEY: string;
  readonly CLERK_ISSUER: string;
  readonly CLERK_AUTHORIZED_PARTIES: string;
  readonly DATABASE_URL: string;
  readonly SPEECHMATICS_API_KEY: string;
  readonly UPSTASH_REDIS_TOKEN: string;
  readonly UPSTASH_REDIS_URL: string;

  // ── Feature 10: Sealed Exports ──
  readonly MANIFEST_SIGNING_KEY: string;
  readonly MANIFEST_SIGNING_KEY_ID: string;
  readonly MANIFEST_SIGNING_KEYS_LEGACY: string; // JSON: '{"k1":"hex_key"}'

   // ── Notifications ──
  readonly RESEND_API_KEY: string;

  // ── Route Planner ──
  readonly MAPBOX_ACCESS_TOKEN: string;

  // ── Plaintext Variables ──
  readonly ALLOWED_ORIGIN: string;
  readonly MAX_PAGE_SIZE: string;
  readonly READ_ONLY_MODE: string;
  readonly WEBHOOKS_PAUSED: string;

  // ── R2 Bucket ──
  readonly INSPECTVOICE_BUCKET: R2Bucket;

  // ── Queues ──
  readonly AUDIO_PROCESSING_QUEUE: Queue;
  readonly PDF_GENERATION_QUEUE: Queue;
}

// =============================================
// REQUEST CONTEXT
// =============================================

/**
 * Injected into every authenticated route handler by the guard middleware.
 * Contains verified identity, tenant isolation, and request metadata.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly userRole: string;
  readonly method: string;
  readonly path: string;
  readonly startedAt: number;
  readonly env: Env;
  /** Display name for audit trails (populated by some routes) */
  readonly userName?: string;
}

// =============================================
// ROUTING
// =============================================

/** Extracted path parameters from route matching */
export type RouteParams = Record<string, string>;

/** Authenticated route handler signature */
export type RouteHandler = (
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
) => Promise<Response>;

/** Webhook route handler signature (no JWT auth, signature-verified) */
export type WebhookHandler = (
  request: Request,
  ctx: {
    readonly requestId: string;
    readonly method: string;
    readonly path: string;
    readonly startedAt: number;
    readonly env: Env;
  },
) => Promise<Response>;

// =============================================
// QUEUE MESSAGES
// =============================================

export interface AudioTranscriptionMessage {
  readonly type: 'audio_transcription';
  readonly r2Key: string;
  readonly inspectionItemId: string;
  readonly orgId: string;
  readonly userId: string;
}

export interface PdfGenerationMessage {
  readonly type: 'pdf_generation';
  readonly inspectionId: string;
  readonly orgId: string;
  readonly userId: string;
}

export type QueueMessageBody = AudioTranscriptionMessage | PdfGenerationMessage;

// =============================================
// CLERK JWT
// =============================================

/**
 * Clerk JWT payload after verification.
 * Supports both v1 (flat claims) and v2 (nested o object) formats.
 */
export interface ClerkJwtPayload {
  /** Subject — Clerk user ID (e.g. 'user_2abc...') */
  readonly sub: string;

  /** Authorised party — the frontend origin */
  readonly azp?: string;

  /** Expiry (Unix timestamp) */
  readonly exp?: number;

  /** Issued at (Unix timestamp) */
  readonly iat?: number;

  /** Not before (Unix timestamp) */
  readonly nbf?: number;

  /** Issuer — Clerk domain */
  readonly iss?: string;

  /** Session ID */
  readonly sid?: string;

  /** Session status */
  readonly sts?: string;

  /** JWT version */
  readonly v?: number;

  /** Feature version array */
  readonly fva?: readonly number[];

  // ── Clerk v1 org claims (flat) ──

  /** Organisation ID (v1 format) */
  readonly org_id?: string;

  /** Organisation role (v1 format, e.g. 'admin', 'org:admin') */
  readonly org_role?: string;

  /** Organisation slug (v1 format) */
  readonly org_slug?: string;

  // ── Clerk v2 org claims (nested) ──

  /** Organisation object (v2 format) */
  readonly o?: {
    readonly id: string;
    readonly rol: string;
    readonly slg?: string;
  };
}

// =============================================
// API RESPONSE ENVELOPES
// =============================================

export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly requestId: string;
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

export interface ApiPaginatedResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly pagination: {
    readonly total: number;
    readonly limit: number;
    readonly offset: number;
  };
  readonly requestId: string;
}

// =============================================
// FEATURE 10: TAMPER-EVIDENT EXPORTS
// =============================================

export type SealedExportType = 'pdf_report' | 'defect_export' | 'claims_pack';

export interface ManifestFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly content_type: string;
}

export interface ExportManifest {
  readonly version: 1;
  readonly bundle_id: string;
  readonly generated_at: string;
  readonly generated_by: {
    readonly user_id: string;
    readonly display_name: string;
  };
  readonly org_id: string;
  readonly export_type: SealedExportType;
  readonly source_id: string | null;
  readonly signature_algorithm: 'HMAC-SHA256';
  readonly signing_key_id: string;
  readonly verify_url: string;
  readonly prev_bundle_hash: string | null;
  readonly files: readonly ManifestFileEntry[];
}

export interface BundleFile {
  readonly path: string;
  readonly data: Uint8Array;
  readonly contentType: string;
}

export interface SealedBundle {
  readonly bundleId: string;
  readonly zipBytes: Uint8Array;
  readonly manifest: ExportManifest;
  readonly manifestJson: string;
  readonly manifestSha256: string;
  readonly manifestSig: string;
  readonly totalBytes: number;
}

export interface SealedExportRow {
  readonly id: string;
  readonly bundle_id: string;
  readonly org_id: string;
  readonly export_type: SealedExportType;
  readonly source_id: string | null;
  readonly file_count: number;
  readonly total_bytes: number;
  readonly r2_key: string;
  readonly manifest_sha256: string;
  readonly manifest_sig: string;
  readonly signing_key_id: string;
  readonly prev_bundle_hash: string | null;
  readonly generated_by: string;
  readonly generated_at: string;
  readonly created_at: string;
}
