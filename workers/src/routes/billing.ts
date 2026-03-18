/**
 * InspectVoice — Billing Route Handlers
 * Stripe Checkout, Customer Portal, and subscription status.
 *
 * Endpoints:
 *   GET  /api/v1/billing/status    → subscription + trial status
 *   POST /api/v1/billing/checkout  → create Stripe Checkout session
 *   POST /api/v1/billing/portal    → create Stripe Customer Portal session
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { neon } from '@neondatabase/serverless';
import type { RequestContext, RouteParams } from '../types';
import { Logger } from '../shared/logger';
import { AppError } from '../shared/errors';
import { checkRateLimit } from '../middleware/rateLimit';
import { validateCsrf } from '../middleware/csrf';
import { requireRole } from '../middleware/guard';

// =============================================
// STRIPE API HELPER
// =============================================

async function stripeRequest(
  path: string,
  secretKey: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });

  const data = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const error = data['error'] as Record<string, unknown> | undefined;
    const message = typeof error?.['message'] === 'string' ? error['message'] : 'Stripe API error';
    throw new AppError('EXTERNAL_SERVICE_ERROR', message, 502);
  }

  return data;
}

// =============================================
// GET /api/v1/billing/status
// =============================================

export async function getBillingStatus(
  _request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  await checkRateLimit(ctx, 'read');
  const sql = neon(ctx.env.DATABASE_URL);

  const rows = await sql(
    `SELECT subscription_status, subscription_plan, subscription_current_period_end,
            trial_ends_at, stripe_customer_id, stripe_subscription_id, tier,
            created_at
     FROM organisations WHERE org_id = $1 LIMIT 1`,
    [ctx.orgId],
  );

  const org = rows[0] as Record<string, unknown> | undefined;

  if (!org) {
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          status: 'trialing',
          trial_ends_at: null,
          trial_days_remaining: 30,
          has_subscription: false,
          needs_upgrade: false,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const now = new Date();
  const trialEndsAt = org['trial_ends_at'] ? new Date(org['trial_ends_at'] as string) : null;
  const subscriptionStatus = (org['subscription_status'] as string) ?? 'trialing';
  const hasActiveSubscription = ['active', 'trialing'].includes(subscriptionStatus) && org['stripe_subscription_id'];

  let trialDaysRemaining: number | null = null;
  let trialExpired = false;

  if (trialEndsAt) {
    trialDaysRemaining = Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    trialExpired = trialDaysRemaining <= 0;
  }

  const needsUpgrade = trialExpired && !hasActiveSubscription;

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        status: hasActiveSubscription ? 'active' : trialExpired ? 'expired' : 'trialing',
        subscription_status: subscriptionStatus,
        subscription_plan: org['subscription_plan'] ?? null,
        subscription_current_period_end: org['subscription_current_period_end'] ?? null,
        trial_ends_at: org['trial_ends_at'] ?? null,
        trial_days_remaining: trialDaysRemaining,
        trial_expired: trialExpired,
        has_subscription: Boolean(hasActiveSubscription),
        needs_upgrade: needsUpgrade,
        has_payment_method: Boolean(org['stripe_customer_id']),
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// =============================================
// POST /api/v1/billing/checkout
// =============================================

export async function createCheckoutSession(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');
  requireRole(ctx, 'admin');

  const logger = Logger.fromContext(ctx);
  const sql = neon(ctx.env.DATABASE_URL);

  // Get or create Stripe customer
  const rows = await sql(
    `SELECT stripe_customer_id, name FROM organisations WHERE org_id = $1 LIMIT 1`,
    [ctx.orgId],
  );

  const org = rows[0] as Record<string, unknown> | undefined;
  let customerId = org?.['stripe_customer_id'] as string | null;

  if (!customerId) {
    // Create Stripe customer
    const userRows = await sql(
      `SELECT email FROM users WHERE user_id = $1 LIMIT 1`,
      [ctx.userId],
    );
    const userEmail = (userRows[0] as Record<string, unknown> | undefined)?.['email'] as string ?? '';
    const orgName = (org?.['name'] as string) ?? 'Organisation';

    const customer = await stripeRequest('/customers', ctx.env.STRIPE_SECRET_KEY, {
      'email': userEmail,
      'name': orgName,
      'metadata[org_id]': ctx.orgId,
    });

    customerId = customer['id'] as string;

    await sql(
      `UPDATE organisations SET stripe_customer_id = $1, updated_at = NOW() WHERE org_id = $2`,
      [customerId, ctx.orgId],
    );
  }

  // Create Checkout Session with 30-day trial
  const frontendUrl = ctx.env.FRONTEND_URL || 'https://inspectvoice.co.uk';

  const session = await stripeRequest('/checkout/sessions', ctx.env.STRIPE_SECRET_KEY, {
    'customer': customerId,
    'mode': 'subscription',
    'line_items[0][price]': ctx.env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    'subscription_data[trial_period_days]': '30',
    'subscription_data[metadata][org_id]': ctx.orgId,
    'success_url': `${frontendUrl}/settings?billing=success`,
    'cancel_url': `${frontendUrl}/settings?billing=cancelled`,
    'allow_promotion_codes': 'true',
  });

  logger.info('Checkout session created', { orgId: ctx.orgId, sessionId: session['id'] });

  return new Response(
    JSON.stringify({
      success: true,
      data: { checkout_url: session['url'] as string },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// =============================================
// POST /api/v1/billing/portal
// =============================================

export async function createPortalSession(
  request: Request,
  _params: RouteParams,
  ctx: RequestContext,
): Promise<Response> {
  validateCsrf(request);
  await checkRateLimit(ctx, 'write');
  requireRole(ctx, 'admin');

  const sql = neon(ctx.env.DATABASE_URL);

  const rows = await sql(
    `SELECT stripe_customer_id FROM organisations WHERE org_id = $1 LIMIT 1`,
    [ctx.orgId],
  );

  const customerId = (rows[0] as Record<string, unknown> | undefined)?.['stripe_customer_id'] as string | null;

  if (!customerId) {
    throw new AppError('VALIDATION_ERROR', 'No billing account found. Please subscribe first.', 400);
  }

  const frontendUrl = ctx.env.FRONTEND_URL || 'https://inspectvoice.co.uk';

  const session = await stripeRequest('/billing_portal/sessions', ctx.env.STRIPE_SECRET_KEY, {
    'customer': customerId,
    'return_url': `${frontendUrl}/settings`,
  });

  return new Response(
    JSON.stringify({
      success: true,
      data: { portal_url: session['url'] as string },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
