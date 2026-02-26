/**
 * InspectVoice — Worker Type Definitions
 * workers/src/types.ts
 *
 * Central type definitions for the Cloudflare Worker.
 * All interfaces used across routes, middleware, and services.
 *
 * UPDATED: Feature 16 (Client Portal) types added.
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

  // ── Feature 16: Client Portal Clerk (separate Clerk application) ──
  readonly PORTAL_CLERK_JWKS_URL: string;
  readonly PORTAL_CLERK_SECRET_KEY: string;
  readonly PORTAL_CLERK_ISSUER: string;
  readonly PORTAL_CLERK_AUTHORIZED_PARTIES: string;

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
// REQUEST CONTEXT (Inspector Platform)
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
// PORTAL REQUEST CONTEXT (Client Portal)
// =============================================

/**
 * Injected into every authenticated portal route handler by portalGuard.
 * Separate from RequestContext — different identity model, different tenant.
 *
 * Key difference: inspector RequestContext has orgId (inspector's company),
 * portal PortalRequestContext has clientWorkspaceId (client's workspace).
 * These two identity spaces NEVER cross.
 */
export interface PortalRequestContext {
  readonly requestId: string;
  /** Clerk user ID from the client's Clerk instance */
  readonly clientUserId: string;
  /** Internal client_users.id (UUID) — resolved from Clerk user ID */
  readonly clientUserDbId: string;
  /** Client workspace UUID — resolved from client's Clerk org */
  readonly clientWorkspaceId: string;
  /** Client role: viewer | contributor | admin */
  readonly clientRole: ClientUserRole;
  /** Client user's display name (for audit trails) */
  readonly clientUserName: string;
  readonly method: string;
  readonly path: string;
  readonly startedAt: number;
  readonly env: Env;
}

// =============================================
// MAGIC LINK CONTEXT
// =============================================

/**
 * Context for magic link requests — no Clerk auth, token-hash verified.
 * Scoped to a single resource with limited metadata.
 */
export interface MagicLinkContext {
  readonly requestId: string;
  readonly magicLinkId: string;
  readonly clientWorkspaceId: string;
  readonly resourceType: ClientMagicLinkResourceType;
  readonly resourceId: string;
  readonly method: string;
  readonly path: string;
  readonly startedAt: number;
  readonly env: Env;
}

// =============================================
// ROUTING
// =============================================

/** Extracted path parameters from route matching */
export type RouteParams = Record<string, string>;

/** Authenticated route handler signature (inspector platform) */
export type RouteHandler = (
  request: Request,
  params: RouteParams,
  ctx: RequestContext,
) => Promise<Response>;

/** Portal route handler signature — uses PortalRequestContext */
export type PortalRouteHandler = (
  request: Request,
  params: RouteParams,
  ctx: PortalRequestContext,
) => Promise<Response>;

/** Magic link route handler signature */
export type MagicLinkRouteHandler = (
  request: Request,
  params: RouteParams,
  ctx: MagicLinkContext,
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

// =============================================
// FEATURE 16: CLIENT PORTAL TYPES
// =============================================

// ── Enums ──

export type ClientWorkspaceStatus = 'active' | 'suspended' | 'archived';
export type ClientProviderStatus = 'active' | 'revoked';
export type ClientUserRole = 'viewer' | 'contributor' | 'admin';

export type ClientDefectUpdateType =
  | 'acknowledged'
  | 'comment'
  | 'work_complete'
  | 'contractor_booked'
  | 'unable_to_action';

export type ClientProposedStatus =
  | 'work_complete_client_reported'
  | 'contractor_booked'
  | 'unable_to_action';

export type ClientMagicLinkResourceType =
  | 'inspection_pdf'
  | 'defect_export'
  | 'sealed_bundle';

export type ClientNotificationType =
  | 'report_published'
  | 'critical_defect'
  | 'defect_status_changed'
  | 'remedial_complete'
  | 'comment_mention';

// ── Entities (1:1 with DB schema) ──

export interface ClientWorkspace {
  readonly id: string;
  readonly clerk_org_id: string;
  readonly name: string;
  readonly slug: string;
  readonly branding: ClientWorkspaceBranding;
  readonly settings: ClientWorkspaceSettings;
  readonly status: ClientWorkspaceStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientWorkspaceBranding {
  readonly logo_url?: string;
  readonly primary_color?: string;
  readonly company_name?: string;
}

export interface ClientWorkspaceSettings {
  readonly powered_by_visible: boolean;
}

export interface ClientWorkspaceProvider {
  readonly id: string;
  readonly client_workspace_id: string;
  readonly org_id: string;
  readonly status: ClientProviderStatus;
  readonly linked_at: string;
  readonly linked_by: string;
}

export interface ClientUser {
  readonly id: string;
  readonly clerk_user_id: string;
  readonly client_workspace_id: string;
  readonly role: ClientUserRole;
  readonly name: string;
  readonly email: string;
  readonly job_title: string | null;
  readonly notification_preferences: ClientNotificationPreferences;
  readonly site_subscriptions: readonly string[];
  readonly is_active: boolean;
  readonly invited_by: string | null;
  readonly invited_at: string | null;
  readonly last_login_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientNotificationPreferences {
  readonly report_published: boolean;
  readonly critical_defect: boolean;
  readonly defect_status_changed: boolean;
  readonly remedial_complete: boolean;
  readonly comment_mention: boolean;
}

export interface ClientSiteAccess {
  readonly id: string;
  readonly client_workspace_id: string;
  readonly site_id: string;
  readonly access_level: 'full' | 'restricted';
  readonly granted_by: string;
  readonly granted_at: string;
}

export interface ClientDefectUpdate {
  readonly id: string;
  readonly client_workspace_id: string;
  readonly defect_id: string;
  readonly client_user_id: string;
  readonly update_type: ClientDefectUpdateType;
  readonly comment: string | null;
  readonly attachments: readonly ClientAttachment[];
  readonly proposed_status: ClientProposedStatus | null;
  readonly inspector_verified: boolean;
  readonly inspector_verified_by: string | null;
  readonly inspector_verified_at: string | null;
  readonly inspector_notes: string | null;
  readonly created_at: string;
}

export interface ClientAttachment {
  readonly r2_key: string;
  readonly filename: string;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly uploaded_at: string;
}

export interface ClientMagicLink {
  readonly id: string;
  readonly client_workspace_id: string;
  readonly resource_type: ClientMagicLinkResourceType;
  readonly resource_id: string;
  readonly token_hash: string;
  readonly created_by: string;
  readonly expires_at: string;
  readonly max_uses: number;
  readonly use_count: number;
  readonly first_accessed_at: string | null;
  readonly last_accessed_at: string | null;
  readonly last_accessed_ip_hash: string | null;
  readonly last_accessed_user_agent: string | null;
  readonly created_at: string;
}

export interface ClientNotification {
  readonly id: string;
  readonly client_workspace_id: string;
  readonly client_user_id: string;
  readonly notification_type: ClientNotificationType;
  readonly site_id: string | null;
  readonly title: string;
  readonly body: string;
  readonly link_url: string | null;
  readonly is_read: boolean;
  readonly email_sent: boolean;
  readonly created_at: string;
}

// ── Client Portal API shapes ──

export interface CreateClientWorkspaceRequest {
  readonly name: string;
  readonly slug: string;
  readonly branding?: Partial<ClientWorkspaceBranding>;
  readonly settings?: Partial<ClientWorkspaceSettings>;
}

export interface InviteClientUserRequest {
  readonly email: string;
  readonly name: string;
  readonly role: ClientUserRole;
  readonly job_title?: string;
  readonly site_ids?: readonly string[];
}

export interface CreateClientDefectUpdateRequest {
  readonly defect_id: string;
  readonly update_type: ClientDefectUpdateType;
  readonly comment?: string;
  readonly attachments?: readonly ClientAttachment[];
  readonly proposed_status?: ClientProposedStatus;
}

export interface VerifyClientDefectUpdateRequest {
  readonly inspector_notes?: string;
  readonly verified: boolean;
}

export interface CreateMagicLinkRequest {
  readonly resource_type: ClientMagicLinkResourceType;
  readonly resource_id: string;
  readonly client_workspace_id: string;
  readonly max_uses?: number;
  readonly expires_in_hours?: number;
}

export interface MagicLinkCreatedResponse {
  readonly token: string;
  readonly magic_link_url: string;
  readonly expires_at: string;
  readonly max_uses: number;
}

export interface ClientDashboardResponse {
  readonly workspace: Pick<ClientWorkspace, 'id' | 'name' | 'branding'>;
  readonly site_count: number;
  readonly total_defects_open: number;
  readonly critical_defects_open: number;
  readonly recent_reports: readonly ClientReportSummary[];
  readonly pending_actions: number;
}

export interface ClientReportSummary {
  readonly inspection_id: string;
  readonly site_name: string;
  readonly inspection_type: string;
  readonly signed_at: string;
  readonly overall_risk_rating: string | null;
  readonly total_defects: number;
  readonly pdf_url: string | null;
}
