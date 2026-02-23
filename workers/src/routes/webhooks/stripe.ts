/**
 * InspectVoice — Stripe Webhook Handler
 * Receives and processes Stripe events for subscription management.
 *
 * Events handled:
 *   - customer.subscription.created → set org to active
 *   - customer.subscription.updated → update plan/status
 *   - customer.subscription.deleted → set org to cancelled
 *   - invoice.paid → confirm payment, extend access
 *   - invoice.payment_failed → flag payment issue
 *
 * Security:
 *   - Stripe signature verification (stripe-signature header)
 *   - Event ID idempotency (prevents duplicate processing)
 *   - WEBHOOKS_PAUSED mode (verify + log, skip mutations)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { WebhookContext, Env } from '../../types';
import { claimWebhookEvent, markEventProcessed, markEventFailed } from '../../services/idempotency';
import { writeWebhookAuditLog } from '../../services/audit';
import { Logger } from '../../shared/logger';
import { BadRequestError, UnauthorizedError } from '../../shared/errors';
import { jsonResponse } from '../helpers';

// =============================================
// ENTRY POINT
// =============================================

export async function handleStripeWebhook(
  request: Request,
  ctx: WebhookContext,
): Promise<Response> {
  const logger = Logger.fromWebhookContext(ctx);

  // ── Step 1: Verify Stripe signature ──
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    throw new UnauthorizedError('Missing stripe-signature header');
  }

  const rawBody = await request.text();

  const event = await verifyStripeSignature(rawBody, signature, ctx.env.STRIPE_WEBHOOK_SECRET);

  logger.info('Stripe webhook received', {
    eventType: event.type,
    eventId: event.id,
  });

  // ── Step 2: Idempotency check ──
  const claimed = await claimWebhookEvent(ctx, event.id, 'stripe');
  if (!claimed) {
    logger.info('Stripe event already processed', { eventId: event.id });
    return jsonResponse({ success: true, message: 'Already processed' }, ctx.requestId);
  }

  // ── Step 3: Check WEBHOOKS_PAUSED ──
  if (ctx.env.WEBHOOKS_PAUSED === 'true') {
    logger.info('Webhooks paused — logged but not processed', { eventId: event.id });
    await markEventProcessed(ctx, event.id);
    return jsonResponse({ success: true, message: 'Logged (paused)' }, ctx.requestId);
  }

  // ── Step 4: Process event ──
  try {
    await processStripeEvent(event, ctx, logger);
    await markEventProcessed(ctx, event.id);
  } catch (error) {
    logger.error('Stripe event processing failed', error, { eventId: event.id });
    await markEventFailed(ctx, event.id, 'Stripe event processing failed');
    throw error;
  }

  return jsonResponse({ success: true, message: 'Processed' }, ctx.requestId);
}

// =============================================
// STRIPE SIGNATURE VERIFICATION
// =============================================

/**
 * Verify Stripe webhook signature using Web Crypto API.
 * Stripe uses HMAC-SHA256: t=timestamp,v1=signature
 */
async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<StripeEvent> {
  // Parse signature header: t=123,v1=abc...
  const parts = signatureHeader.split(',');
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const signatureHex = parts.find((p) => p.startsWith('v1='))?.slice(3);

  if (!timestamp || !signatureHex) {
    throw new UnauthorizedError('Invalid stripe-signature format');
  }

  // Reject if timestamp is too old (5 minute tolerance)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) {
    throw new UnauthorizedError('Stripe webhook timestamp too old');
  }

  // Compute expected signature
  const payload = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expectedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Timing-safe comparison
  if (expectedHex.length !== signatureHex.length) {
    throw new UnauthorizedError('Invalid Stripe webhook signature');
  }

  let mismatch = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    mismatch |= (expectedHex.charCodeAt(i) ?? 0) ^ (signatureHex.charCodeAt(i) ?? 0);
  }

  if (mismatch !== 0) {
    throw new UnauthorizedError('Invalid Stripe webhook signature');
  }

  // Parse the event body
  try {
    return JSON.parse(rawBody) as StripeEvent;
  } catch {
    throw new BadRequestError('Invalid JSON in Stripe webhook body');
  }
}

// =============================================
// EVENT PROCESSING
// =============================================

async function processStripeEvent(
  event: StripeEvent,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
      await handleSubscriptionCreated(event, ctx, logger);
      break;

    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event, ctx, logger);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event, ctx, logger);
      break;

    case 'org.subscription_changed':
      await handleInvoicePaid(event, ctx, logger);
      break;

    case 'org.subscription_changed':
      await handleInvoicePaymentFailed(event, ctx, logger);
      break;

    default:
      logger.info('Unhandled Stripe event type', { eventType: event.type });
  }
}

// ── Subscription Created ──

async function handleSubscriptionCreated(
  event: StripeEvent,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const sub = event.data.object as unknown as StripeSubscription;
  const orgId = sub.metadata?.['org_id'];
  if (!orgId) {
    logger.warn('Subscription created without org_id metadata', { subscriptionId: sub.id });
    return;
  }

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  await sql(
    `UPDATE organisations SET
      stripe_customer_id = $1,
      stripe_subscription_id = $2,
      subscription_status = 'active',
      subscription_plan = $3,
      subscription_current_period_end = $4,
      updated_at = NOW()
     WHERE org_id = $5`,
    [
      sub.customer,
      sub.id,
      sub.items?.data?.[0]?.price?.lookup_key ?? 'default',
      sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      orgId,
    ],
  );

  logger.info('Subscription created', { orgId, subscriptionId: sub.id });
  void writeWebhookAuditLog(ctx, orgId, 'org.subscription_changed', 'organisations', orgId, {
    subscriptionId: sub.id,
    status: 'active',
  });
}

// ── Subscription Updated ──

async function handleSubscriptionUpdated(
  event: StripeEvent,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const sub = event.data.object as unknown as StripeSubscription;
  const orgId = sub.metadata?.['org_id'];
  if (!orgId) return;

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  const status = mapStripeStatus(sub.status);

  await sql(
    `UPDATE organisations SET
      subscription_status = $1,
      subscription_plan = $2,
      subscription_current_period_end = $3,
      updated_at = NOW()
     WHERE org_id = $4`,
    [
      status,
      sub.items?.data?.[0]?.price?.lookup_key ?? 'default',
      sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      orgId,
    ],
  );

  logger.info('Subscription updated', { orgId, status });
  void writeWebhookAuditLog(ctx, orgId, 'org.subscription_changed', 'organisations', orgId, { status });
}

// ── Subscription Deleted ──

async function handleSubscriptionDeleted(
  event: StripeEvent,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const sub = event.data.object as unknown as StripeSubscription;
  const orgId = sub.metadata?.['org_id'];
  if (!orgId) return;

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  await sql(
    `UPDATE organisations SET
      subscription_status = 'cancelled',
      updated_at = NOW()
     WHERE org_id = $1`,
    [orgId],
  );

  logger.info('Subscription cancelled', { orgId, subscriptionId: sub.id });
  void writeWebhookAuditLog(ctx, orgId, 'org.subscription_changed', 'organisations', orgId);
}

// ── Invoice Paid ──

async function handleInvoicePaid(
  event: StripeEvent,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const invoice = event.data.object as unknown as StripeInvoice;

  // Resolve org via Stripe customer ID
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  const rows = await sql(
    `SELECT org_id FROM organisations WHERE stripe_customer_id = $1 LIMIT 1`,
    [invoice.customer],
  );

  const orgId = (rows[0] as Record<string, unknown> | undefined)?.['org_id'] as string | undefined;
  if (!orgId) {
    logger.warn('Invoice paid for unknown customer', { customerId: invoice.customer });
    return;
  }

  // Confirm payment — clear any payment issue flags
  await sql(
    `UPDATE organisations SET
      subscription_status = 'active',
      payment_failed_at = NULL,
      updated_at = NOW()
     WHERE org_id = $1`,
    [orgId],
  );

  logger.info('Invoice paid', { orgId, invoiceId: invoice.id });
  void writeWebhookAuditLog(ctx, orgId, 'org.subscription_changed', 'organisations', orgId, {
    invoiceId: invoice.id,
    amount: invoice.amount_paid,
  });
}

// ── Invoice Payment Failed ──

async function handleInvoicePaymentFailed(
  event: StripeEvent,
  ctx: WebhookContext,
  logger: Logger,
): Promise<void> {
  const invoice = event.data.object as unknown as StripeInvoice;

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(ctx.env.DATABASE_URL);

  const rows = await sql(
    `SELECT org_id FROM organisations WHERE stripe_customer_id = $1 LIMIT 1`,
    [invoice.customer],
  );

  const orgId = (rows[0] as Record<string, unknown> | undefined)?.['org_id'] as string | undefined;
  if (!orgId) return;

  await sql(
    `UPDATE organisations SET
      subscription_status = 'past_due',
      payment_failed_at = NOW(),
      updated_at = NOW()
     WHERE org_id = $1`,
    [orgId],
  );

  logger.info('Invoice payment failed', { orgId, invoiceId: invoice.id });
  void writeWebhookAuditLog(ctx, orgId, 'org.subscription_changed', 'organisations', orgId, {
    invoiceId: invoice.id,
  });
}

// =============================================
// HELPERS
// =============================================

function mapStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'active': return 'active';
    case 'trialing': return 'trialing';
    case 'past_due': return 'past_due';
    case 'canceled':
    case 'cancelled': return 'cancelled';
    case 'unpaid': return 'unpaid';
    case 'incomplete': return 'incomplete';
    case 'incomplete_expired': return 'expired';
    default: return stripeStatus;
  }
}

// =============================================
// STRIPE TYPES (minimal — only what we use)
// =============================================

interface StripeEvent {
  readonly id: string;
  readonly type: string;
  readonly data: {
    readonly object: Record<string, unknown>;
  };
}

interface StripeSubscription {
  readonly id: string;
  readonly customer: string;
  readonly status: string;
  readonly current_period_end?: number;
  readonly metadata?: Record<string, string>;
  readonly items?: {
    readonly data?: Array<{
      readonly price?: {
        readonly lookup_key?: string;
      };
    }>;
  };
}

interface StripeInvoice {
  readonly id: string;
  readonly customer: string;
  readonly amount_paid?: number;
  readonly status?: string;
}
