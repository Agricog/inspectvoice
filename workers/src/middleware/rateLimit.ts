/**
 * InspectVoice — Rate Limiting Middleware
 * Per-user rate limiting via Upstash Redis.
 *
 * Uses a sliding window approach:
 * - Each user gets a rate limit bucket keyed by userId + endpoint category
 * - Different limits for different endpoint types (reads vs writes vs AI)
 * - Returns standard 429 with Retry-After header on limit hit
 *
 * Upstash Redis is accessed via REST API (no TCP connections needed
 * in Cloudflare Workers).
 *
 * Build Standard: Autaimate v3 §6 — Rate limiting on sensitive endpoints
 */

import type { Env, RequestContext } from '../types';
import { RateLimitError } from '../shared/errors';
import { Logger } from '../shared/logger';

// =============================================
// RATE LIMIT TIERS
// =============================================

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  readonly maxRequests: number;
  /** Window duration in seconds */
  readonly windowSeconds: number;
}

/**
 * Rate limit configurations by endpoint category.
 * Routes specify which category they belong to.
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  /** Standard read endpoints (GET) */
  read: { maxRequests: 120, windowSeconds: 60 },

  /** Standard write endpoints (POST/PUT/DELETE) */
  write: { maxRequests: 60, windowSeconds: 60 },

  /** AI processing endpoints (expensive — Claude API calls) */
  ai: { maxRequests: 20, windowSeconds: 60 },

  /** Upload endpoints (R2 signed URLs) */
  upload: { maxRequests: 30, windowSeconds: 60 },

  /** Auth-related endpoints */
  auth: { maxRequests: 10, windowSeconds: 60 },
} as const;

// =============================================
// RATE LIMIT CHECK
// =============================================

/**
 * Check if the current request exceeds the rate limit.
 * Increments the counter and throws RateLimitError if exceeded.
 *
 * @param ctx — request context (provides userId for the rate limit key)
 * @param category — rate limit category (determines limits)
 * @throws RateLimitError if the user has exceeded the limit
 */
export async function checkRateLimit(
  ctx: RequestContext,
  category: keyof typeof RATE_LIMITS,
): Promise<void> {
  const config = RATE_LIMITS[category];
  if (!config) return; // Unknown category — skip (fail open for unknown categories)

  const key = `rl:${ctx.userId}:${category}`;

  try {
    const result = await upstashIncrement(
      ctx.env.UPSTASH_REDIS_URL,
      ctx.env.UPSTASH_REDIS_TOKEN,
      key,
      config.windowSeconds,
    );

    if (result > config.maxRequests) {
      const logger = Logger.fromContext(ctx);
      logger.warn('Rate limit exceeded', {
        category,
        currentCount: result,
        maxRequests: config.maxRequests,
        windowSeconds: config.windowSeconds,
      });

      throw new RateLimitError(
        config.windowSeconds,
        `Rate limit exceeded. Maximum ${config.maxRequests} requests per ${config.windowSeconds} seconds.`,
      );
    }
  } catch (error) {
    // If it's already a RateLimitError, rethrow
    if (error instanceof RateLimitError) throw error;

    // Redis failure — fail open (don't block users if Redis is down)
    const logger = Logger.fromContext(ctx);
    logger.warn('Rate limit check failed — failing open', {
      category,
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }
}

// =============================================
// UPSTASH REDIS CLIENT (REST API)
// =============================================

/**
 * Increment a rate limit counter in Upstash Redis.
 * Uses a Lua-like atomic INCR + EXPIRE pattern via the REST API.
 *
 * @returns Current count after increment
 */
async function upstashIncrement(
  redisUrl: string,
  redisToken: string,
  key: string,
  ttlSeconds: number,
): Promise<number> {
  // Use Upstash REST API pipeline for atomic INCR + EXPIRE
  const pipelineUrl = `${redisUrl}/pipeline`;

  const commands = [
    ['INCR', key],
    ['EXPIRE', key, String(ttlSeconds)],
  ];

  const response = await fetch(pipelineUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(`Upstash Redis error: ${response.status}`);
  }

  const results = await response.json() as UpstashPipelineResponse;

  // First result is the INCR response — contains the current count
  const incrResult = results[0];
  if (incrResult && typeof incrResult.result === 'number') {
    return incrResult.result;
  }

  // Fallback — shouldn't happen with valid Redis
  return 0;
}

// =============================================
// INTERNAL TYPES
// =============================================

type UpstashPipelineResponse = Array<{
  result: number | string | null;
  error?: string;
}>;
