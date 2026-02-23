/**
 * InspectVoice — Webhook Idempotency Service
 * Prevents duplicate processing of Stripe and Clerk webhooks.
 *
 * Webhooks may be delivered multiple times and out of order.
 * This service stores processed event IDs in a `webhook_events` table
 * and rejects duplicates before any state mutation occurs.
 *
 * Build Standard: Autaimate v3 §5.3 — retry-safe, idempotent webhook handlers
 */

import type { WebhookContext } from '../types';
import { Logger } from '../shared/logger';

// =============================================
// IDEMPOTENCY CHECK
// =============================================

/**
 * Check if a webhook event has already been processed.
 * If not, mark it as processing (claim it).
 *
 * @param ctx — webhook context
 * @param eventId — unique event identifier (e.g. Stripe evt_xxx or Svix msg_xxx)
 * @param source — webhook source ('stripe' | 'clerk')
 * @returns true if this is a new event (proceed with processing)
 *          false if this event was already processed (skip it)
 */
export async function claimWebhookEvent(
  ctx: WebhookContext,
  eventId: string,
  source: 'stripe' | 'clerk',
): Promise<boolean> {
  const logger = Logger.fromWebhookContext(ctx);

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(ctx.env.DATABASE_URL);

    // Attempt to insert — if the (id, source) already exists, ON CONFLICT skips.
    // RETURNING id tells us if the row was actually inserted.
    const result = await sql(
      `INSERT INTO webhook_events (id, source, status, received_at)
       VALUES ($1, $2, 'processing', NOW())
       ON CONFLICT (id, source) DO NOTHING
       RETURNING id`,
      [eventId, source],
    );

    // If result array is empty, the event already existed (duplicate)
    if (result.length === 0) {
      logger.info('Duplicate webhook event skipped', {
        eventId,
        source,
      });
      return false;
    }

    logger.info('Webhook event claimed for processing', {
      eventId,
      source,
    });
    return true;
  } catch (error) {
    // If we can't check idempotency, log and proceed cautiously
    // This is a fail-open decision — better to risk a duplicate than drop events
    logger.error('Idempotency check failed — proceeding with caution', error, {
      eventId,
      source,
    });
    return true;
  }
}

/**
 * Mark a webhook event as successfully processed.
 * Call this after the handler has completed all mutations.
 */
export async function markEventProcessed(
  ctx: WebhookContext,
  eventId: string,
): Promise<void> {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(ctx.env.DATABASE_URL);

    await sql(
      `UPDATE webhook_events
       SET status = 'completed', processed_at = NOW()
       WHERE id = $1`,
      [eventId],
    );
  } catch (error) {
    const logger = Logger.fromWebhookContext(ctx);
    logger.error('Failed to mark webhook event as processed', error, {
      eventId,
    });
  }
}

/**
 * Mark a webhook event as failed.
 * Call this if the handler encounters an error after claiming.
 */
export async function markEventFailed(
  ctx: WebhookContext,
  eventId: string,
  _errorMessage: string,
): Promise<void> {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(ctx.env.DATABASE_URL);

    await sql(
      `UPDATE webhook_events
       SET status = 'failed', processed_at = NOW()
       WHERE id = $1`,
      [eventId],
    );
  } catch (error) {
    const logger = Logger.fromWebhookContext(ctx);
    logger.error('Failed to mark webhook event as failed', error, {
      eventId,
    });
  }
}

// =============================================
// CLEANUP (for maintenance)
// =============================================

/**
 * Purge old webhook events to prevent unbounded table growth.
 * Call periodically (e.g. daily via a scheduled Worker).
 *
 * @param databaseUrl — Neon connection string
 * @param retentionDays — how many days of events to keep (default: 30)
 * @returns Number of rows deleted
 */
export async function purgeOldWebhookEvents(
  databaseUrl: string,
  retentionDays: number = 30,
): Promise<number> {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(databaseUrl);

    const result = await sql(
      `DELETE FROM webhook_events
       WHERE received_at < NOW() - INTERVAL '1 day' * $1
       RETURNING id`,
      [retentionDays],
    );

    return result.length;
  } catch {
    return 0;
  }
}
