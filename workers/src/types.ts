/**
 * InspectVoice — Cloudflare Worker Types
 * Environment bindings, request context, and API envelope types.
 *
 * All Worker code references these types for:
 * - Cloudflare bindings (secrets, R2, queues)
 * - Request context (auth, tenant, requestId)
 * - Standardised API response shapes
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

// =============================================
// CLOUDFLARE ENVIRONMENT BINDINGS
// =============================================

/**
 * All secrets and services bound via wrangler.toml.
 * Never hardcode values — they come from Cloudflare dashboard.
 */
export interface Env {
  // ── Auth (Clerk) ──
  readonly CLERK_SECRET_KEY: string;
  readonly CLERK_JWKS_URL: string;
  readonly CLERK_WEBHOOK_SECRET: string;

  // ── Payments (Stripe) ──
  readonly STRIPE_SECRET_KEY: string;
  readonly STRIPE_WEBHOOK_SECRET: string;

  // ── AI Services ──
  readonly ANTHROPIC_API_KEY: string;
  readonly DEEPGRAM_API_KEY: string;

  // ── Database (Neon PostgreSQL) ──
  readonly DATABASE_URL: string;

  // ── Rate Limiting (Upstash Redis) ──
  readonly UPSTASH_REDIS_URL: string;
  readonly UPSTASH_REDIS_TOKEN: string;

  // ── Storage (Cloudflare R2) ──
  readonly INSPECTVOICE_BUCKET: R2Bucket;

  // ── Queues (Cloudflare Queues) ──
  readonly AUDIO_PROCESSING_QUEUE: Queue<QueueMessageBody>;
  readonly PDF_GENERATION_QUEUE: Queue<QueueMessageBody>;

  // ── Production Safety Switches ──
  readonly READ_ONLY_MODE: string;       // 'true' | 'false'
  readonly WEBHOOKS_PAUSED: string;      // 'true' | 'false'
  readonly MAX_PAGE_SIZE: string;        // e.g. '100'

  // ── CORS ──
  readonly ALLOWED_ORIGIN: string;       // e.g. 'https://inspectvoice.co.uk'
}

// =============================================
// QUEUE MESSAGE TYPES
// =============================================

/** Base queue message shape for all Cloudflare Queue consumers */
export interface QueueMessageBody {
  readonly type: QueueMessageType;
  readonly requestId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly payload: Record<string, string | number | boolean | null>;
  readonly enqueuedAt: string;
}

export type QueueMessageType =
  | 'audio_transcription'
  | 'pdf_generation';

/** Audio processing queue payload */
export interface AudioProcessingPayload {
  readonly r2Key: string;
  readonly inspectionItemId: string;
  readonly assetCode: string;
  readonly assetType: string;
  readonly mimeType: string;
  readonly durationSeconds: number;
}

/** PDF generation queue payload */
export interface PdfGenerationPayload {
  readonly inspectionId: string;
  readonly siteId: string;
}

// =============================================
// REQUEST CONTEXT
// =============================================

/**
 * Authenticated request context, created by the guard middleware.
 * Passed to every route handler — guarantees auth + tenant data is present.
 */
export interface RequestContext {
  /** Unique request identifier for tracing */
  readonly requestId: string;

  /** Authenticated user ID (from Clerk JWT `sub` claim) */
  readonly userId: string;

  /** Organisation/tenant ID (from Clerk JWT `org_id` claim) */
  readonly orgId: string;

  /** User's role within the organisation */
  readonly userRole: string;

  /** HTTP method */
  readonly method: string;

  /** Request path */
  readonly path: string;

  /** Request start time for latency measurement */
  readonly startedAt: number;

  /** Cloudflare environment bindings */
  readonly env: Env;
}

/**
 * Webhook request context — no Clerk auth, uses signature verification instead.
 */
export interface WebhookContext {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly startedAt: number;
  readonly env: Env;
}

// =============================================
// API RESPONSE ENVELOPES
// =============================================

/**
 * Standard success response envelope.
 * All API endpoints return this shape for consistency.
 */
export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: ApiResponseMeta;
}

/**
 * Standard error response envelope.
 */
export interface ApiErrorResponse {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

/**
 * Paginated response metadata.
 */
export interface ApiResponseMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly totalPages: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
}

/**
 * Paginated list response — extends success envelope with meta.
 */
export interface ApiListResponse<T> {
  readonly success: true;
  readonly data: T[];
  readonly meta: ApiResponseMeta;
}

// =============================================
// ROUTE HANDLER TYPE
// =============================================

/**
 * Standard route handler signature.
 * Every route handler receives the raw Request, URL params, and RequestContext.
 */
export type RouteHandler = (
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
) => Promise<Response>;

/**
 * Webhook route handler — uses WebhookContext instead of RequestContext.
 */
export type WebhookHandler = (
  request: Request,
  ctx: WebhookContext,
) => Promise<Response>;

/**
 * URL path parameters extracted from route matching.
 */
export interface RouteParams {
  readonly [key: string]: string | undefined;
}

// =============================================
// PARSED PAGINATION INPUT
// =============================================

/**
 * Validated pagination parameters from query string.
 */
export interface PaginationInput {
  readonly page: number;
  readonly pageSize: number;
}

// =============================================
// CLERK JWT CLAIMS
// =============================================

/**
 * Expected shape of a verified Clerk JWT payload.
 * Only the fields we use — Clerk JWTs contain more.
 */
export interface ClerkJwtPayload {
  readonly sub: string;         // userId
  readonly org_id?: string;     // organisationId (present when user has active org)
  readonly org_role?: string;   // role within org
  readonly iss: string;         // issuer
  readonly exp: number;         // expiry (Unix seconds)
  readonly iat: number;         // issued at
  readonly nbf: number;         // not before
}

// =============================================
// HELPER TYPE UTILITIES
// =============================================

/**
 * Make specific keys required on a type.
 * Useful for DB insert shapes where some fields have defaults.
 */
export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

/**
 * Extract the data type from an ApiSuccessResponse.
 */
export type ExtractApiData<T> = T extends ApiSuccessResponse<infer D> ? D : never;
