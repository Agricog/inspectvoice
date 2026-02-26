/**
 * InspectVoice — Feature 16: Client Portal Type Additions
 * workers/src/types-feature16-additions.ts
 *
 * ══════════════════════════════════════════════════════════════════
 * MERGE GUIDE — Add these to workers/src/types.ts
 * ══════════════════════════════════════════════════════════════════
 *
 * 1. Add Portal Clerk secrets to the Env interface (Section: Secrets)
 * 2. Add PortalRequestContext after the existing RequestContext
 * 3. Add PortalRouteHandler after the existing RouteHandler
 * 4. Add all Client Portal entity types at the bottom
 *
 * Do NOT replace the file — merge additions into the existing types.ts
 * ══════════════════════════════════════════════════════════════════
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

// =============================================
// ENV ADDITIONS — merge into existing Env interface
// =============================================

/**
 * Add these 4 secrets to the Env interface under a new comment block:
 *
 *   // ── Client Portal Clerk (separate Clerk application) ──
 *   readonly PORTAL_CLERK_JWKS_URL: string;
 *   readonly PORTAL_CLERK_SECRET_KEY: string;
 *   readonly PORTAL_CLERK_ISSUER: string;
 *   readonly PORTAL_CLERK_AUTHORIZED_PARTIES: string;
 */

// =============================================
// PORTAL REQUEST CONTEXT
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
  readonly clientRole: 'viewer' | 'contributor' | 'admin';

  /** Client user's display name (for audit trails) */
  readonly clientUserName: string;

  readonly method: string;
  readonly path: string;
  readonly startedAt: number;
  readonly env: Env;
}

/** Portal route handler signature — uses PortalRequestContext, not RequestContext */
export type PortalRouteHandler = (
  request: Request,
  params: RouteParams,
  ctx: PortalRequestContext,
) => Promise<Response>;

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

/** Magic link route handler signature */
export type MagicLinkRouteHandler = (
  request: Request,
  params: RouteParams,
  ctx: MagicLinkContext,
) => Promise<Response>;

// =============================================
// CLIENT PORTAL ENTITY TYPES
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
  /** SHA-256 hash — plaintext token is NEVER stored */
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

// ── API request/response shapes ──

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
  /** Expiry in hours from now (default 72, max 720 = 30 days) */
  readonly expires_in_hours?: number;
}

export interface MagicLinkCreatedResponse {
  /** The plaintext token — shown ONCE, then irrecoverable */
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
