/**
 * InspectVoice — Clerk Webhook Handler
 * Receives and processes Clerk events for user and organisation sync.
 *
 * Events handled:
 *   - user.created → create user record in DB
 *   - user.updated → update user record
 *   - user.deleted → soft-delete user
 *   - organization.created → create org record
 *   - organization.updated → update org record
 *   - organizationMembership.created → link user to org with role
 *   - organizationMembership.deleted → remove user-org link
 *
 * Security:
 *   - Svix signature verification (svix-id, svix-timestamp, svix-signature)
 *   - Event ID idempotency
 *   - WEBHOOKS_PAUSED mode
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { WebhookContext } from '../../types';
import { claimWebhookEvent, markEventProcessed, markEventFailed } from '../../services/idempotency';
import { writeWebhookAuditLog } from '../../services/audit';
import { Logger } from '../../shared/logger';
import { UnauthorizedError, BadRequestError } from '../../shared/errors';
import { jsonResponse } from '../helpers';

// =============================================
// ENTRY POINT
// =============================================

export async function handleClerkWebhook(
  request: Request,
  ctx: WebhookContext,
): Promise<Response> {
  const logger = Logger.fromWebhookContext(ctx);

  // ── Step 1: Verify Svix signature ──
  const rawBody = await request.text();
  const event = await verifySvixSignature(
    rawBody,
    request.headers,
    ctx.env.CLERK_WEBHOOK_SECRET,
  );

  logger.info('Clerk webhook received', {
    eventType: event.type,
    eventId: event.id,
  });

  // ── Step 2: Idempotency check ──
  const claimed = await claimWebhookEvent(ctx, event.id, 'clerk');
  if (!claimed) {
    logger.info('Clerk event already processed', { eventId: event.id });
    return jsonResponse({ success: true, message: 'Already processed' }, ctx.requestId);
  }

  // ── Step 3: Check WEBHOOKS_PAUSED ──
  if (ctx.env.WEBHOOKS_PAUSED === 'true') {
    logger.info('Webhooks paused — logged but not processed', { eventId: event.id });
    await markEventProcessed(ctx, event.id, 'clerk');
    return jsonResponse({ success: true, message: 'Logged (paused)' }, ctx.requestId);
  }

  // ── Step 4: Process event ──
  try {
    await processClerkEvent(event, ctx, logger);
    await markEventProcessed(ctx, event.id, 'clerk');
  } catch (error) {
    logger.error('Clerk event processing failed', error, { eventId: event.id });
    await markEventFailed(ctx, event.id, 'clerk');
    throw error;
  }

  return jsonResponse({ success: true, message: 'Processed' }, ctx.requestId);
}

// =============================================
// SVIX SIGNATURE VERIFICATION
// =============================================

/**
 * Verify Clerk/Svix webhook signature.
 * Svix uses HMAC-SHA256 with base64-encoded secret (after stripping "whsec_" prefix).
 * The signed content is: "{svix-id}.{svix-timestamp}.{body}"
 */
async function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<ClerkEvent> {
  const svixId = headers.get('svix-id');
  const svixTimestamp = headers.get('svix-timestamp');
  const svixSignature = headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new UnauthorizedError('Missing Svix signature headers');
  }

  // Reject if timestamp is too old (5 minute tolerance)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(svixTimestamp)) > 300) {
    throw new UnauthorizedError('Svix webhook timestamp too old');
  }

  // Svix secret format: "whsec_<base64>" — strip prefix
  const secretKey = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const secretBytes = base64ToUint8Array(secretKey);

  // Signed content: "{svix-id}.{svix-timestamp}.{body}"
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signedContent));
  const expectedBase64 = uint8ArrayToBase64(new Uint8Array(signatureBytes));

  // Svix may send multiple signatures: "v1,<sig1> v1,<sig2>"
  const signatures = svixSignature.split(' ');
  let verified = false;

  for (const sig of signatures) {
    const parts = sig.split(',');
    if (parts.length < 2) continue;

    const sigVersion = parts[0];
    const sigValue = parts.slice(1).join(',');

    if (sigVersion !== 'v1') continue;

    // Timing-safe comparison
    if (sigValue.length === expectedBase64.length) {
      let mismatch = 0;
      for (let i = 0; i < sigValue.length; i++) {
        mismatch |= (sigValue.charCodeAt(i) ?? 0) ^ (expectedBase64.charCodeAt(i) ?? 0);
      }
      if (mismatch === 0) {
        verified = true;
        break;
      }
    }
  }

  if (!verified) {
    throw new UnauthorizedError('Invalid Svix webhook signature');
  }

  try {
    return JSON.parse(rawBody) as ClerkEvent;
  } catch {
    throw new BadRequestError('Invalid JSON in Clerk webhook body');
  }
}

// =============================================
// EVENT PROCESSING
// =============================================

async function processClerkEvent(
  event: ClerkEvent,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  switch (event.type) {
    case 'user.created':
      await handleUserCreated(event.data as ClerkUser, ctx, logger);
      break;

    case 'user.updated':
      await handleUserUpdated(event.data as ClerkUser, ctx, logger);
      break;

    case 'user.deleted':
      await handleUserDeleted(event.data as ClerkUser, ctx, logger);
      break;

    case 'organization.created':
      await handleOrgCreated(event.data as ClerkOrganization, ctx, logger);
      break;

    case 'organization.updated':
      await handleOrgUpdated(event.data as ClerkOrganization, ctx, logger);
      break;

    case 'organizationMembership.created':
      await handleMembershipCreated(event.data as ClerkMembership, ctx, logger);
      break;

    case 'organizationMembership.deleted':
      await handleMembershipDeleted(event.data as ClerkMembership, ctx, logger);
      break;

    default:
      logger.info('Unhandled Clerk event type', { eventType: event.type });
  }
}

// ── User Events ──

async function handleUserCreated(
  user: ClerkUser,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  const email = user.email_addresses?.find(
    (e) => e.id === user.primary_email_address_id,
  )?.email_address ?? null;

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || email || 'User';

  await sql(
    `INSERT INTO users (id, email, display_name, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = EXCLUDED.display_name,
       updated_at = NOW()`,
    [user.id, email, displayName],
  );

  logger.info('User created from Clerk webhook', { userId: user.id });
}

async function handleUserUpdated(
  user: ClerkUser,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  const email = user.email_addresses?.find(
    (e) => e.id === user.primary_email_address_id,
  )?.email_address ?? null;

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || email || 'User';

  await sql(
    `UPDATE users SET
       email = $1,
       display_name = $2,
       updated_at = NOW()
     WHERE id = $3`,
    [email, displayName, user.id],
  );

  logger.info('User updated from Clerk webhook', { userId: user.id });
}

async function handleUserDeleted(
  user: ClerkUser,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  // Soft delete — preserve for audit trail
  await sql(
    `UPDATE users SET
       is_active = false,
       deactivated_at = NOW(),
       updated_at = NOW()
     WHERE id = $1`,
    [user.id],
  );

  logger.info('User deactivated from Clerk webhook', { userId: user.id });
}

// ── Organisation Events ──

async function handleOrgCreated(
  org: ClerkOrganization,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  await sql(
    `INSERT INTO organisations (org_id, company_name, subscription_status, created_at, updated_at)
     VALUES ($1, $2, 'trialing', NOW(), NOW())
     ON CONFLICT (org_id) DO UPDATE SET
       company_name = EXCLUDED.company_name,
       updated_at = NOW()`,
    [org.id, org.name],
  );

  logger.info('Organisation created from Clerk webhook', { orgId: org.id });
  void writeWebhookAuditLog(ctx, org.id, 'org.settings_updated', 'organisations', org.id, {
    event: 'created',
    name: org.name,
  });
}

async function handleOrgUpdated(
  org: ClerkOrganization,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  await sql(
    `UPDATE organisations SET
       company_name = $1,
       updated_at = NOW()
     WHERE org_id = $2`,
    [org.name, org.id],
  );

  logger.info('Organisation updated from Clerk webhook', { orgId: org.id });
  void writeWebhookAuditLog(ctx, org.id, 'org.settings_updated', 'organisations', org.id, {
    event: 'updated',
    name: org.name,
  });
}

// ── Membership Events ──

async function handleMembershipCreated(
  membership: ClerkMembership,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  const orgId = membership.organization?.id;
  const userId = membership.public_user_data?.user_id;
  if (!orgId || !userId) {
    logger.warn('Membership created without org or user ID');
    return;
  }

  // Map Clerk role to our role system
  const role = mapClerkRole(membership.role);

  await sql(
    `UPDATE users SET
       org_id = $1,
       role = $2,
       updated_at = NOW()
     WHERE id = $3`,
    [orgId, role, userId],
  );

  logger.info('Membership created', { orgId, userId, role });
  void writeWebhookAuditLog(ctx, orgId, 'user.updated', 'users', userId, {
    event: 'membership_created',
    role,
  });
}

async function handleMembershipDeleted(
  membership: ClerkMembership,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  const orgId = membership.organization?.id;
  const userId = membership.public_user_data?.user_id;
  if (!orgId || !userId) return;

  // Remove org association
  await sql(
    `UPDATE users SET
       org_id = NULL,
       role = NULL,
       updated_at = NOW()
     WHERE id = $1 AND org_id = $2`,
    [userId, orgId],
  );

  logger.info('Membership deleted', { orgId, userId });
  void writeWebhookAuditLog(ctx, orgId, 'user.deactivated', 'users', userId, {
    event: 'membership_deleted',
  });
}

// =============================================
// HELPERS
// =============================================

function mapClerkRole(clerkRole: string): string {
  switch (clerkRole) {
    case 'org:admin':
    case 'admin': return 'admin';
    case 'org:manager':
    case 'manager': return 'manager';
    case 'org:inspector':
    case 'basic_member':
    case 'member':
    default: return 'inspector';
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

// =============================================
// CLERK TYPES (minimal — only what we use)
// =============================================

interface ClerkEvent {
  readonly id: string;
  readonly type: string;
  readonly data: Record<string, unknown>;
}

interface ClerkUser {
  readonly id: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly email_addresses?: Array<{
    readonly id: string;
    readonly email_address: string;
  }>;
  readonly primary_email_address_id?: string;
}

interface ClerkOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug?: string;
}

interface ClerkMembership {
  readonly role: string;
  readonly organization?: { readonly id: string };
  readonly public_user_data?: { readonly user_id: string };
}
