/**
 * InspectVoice — Worker Error Tracking (Sentry)
 * workers/src/shared/sentry.ts
 *
 * Initialises the Sentry Cloudflare Workers SDK and provides typed helpers
 * for the Worker entry point and route handlers. Mirrors the frontend
 * `src/utils/errorTracking.ts` pattern for consistency.
 *
 * Design principles:
 *   1. Sentry is observability, not a dependency. If init fails (DSN missing,
 *      SDK throws, etc.) the Worker continues normally — no request is ever
 *      blocked on Sentry being available.
 *   2. NEVER logs PII or secrets. Bearer tokens, JWTs, API keys, and request
 *      bodies are scrubbed before sending. Same hygiene as the frontend.
 *   3. Tenant context (orgId, userId) attached to every event so errors are
 *      attributable without exposing names/emails.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import * as Sentry from '@sentry/cloudflare';
import type { Env, RequestContext } from '../types';

// =============================================
// CONSTANTS
// =============================================

/** Errors that are noisy but not actionable — filtered before send */
const IGNORED_ERROR_PATTERNS: readonly RegExp[] = [
  /AbortError/i,
  /Request aborted/i,
  /Network request failed/i,
];

/** Header names that may contain credentials — scrubbed from breadcrumbs */
const SENSITIVE_HEADER_NAMES: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'iv-csrf-token',
  'svix-signature',
  'svix-id',
  'stripe-signature',
];

/** Patterns inside log/breadcrumb strings that look like secrets */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9_\-.]+/gi, // JWTs, opaque tokens
  /sk_(live|test)_[A-Za-z0-9]+/gi, // Stripe secret keys
  /pk_(live|test)_[A-Za-z0-9]+/gi, // Stripe publishable keys
  /whsec_[A-Za-z0-9]+/gi,           // Stripe/Clerk webhook secrets
  /sntrys_[A-Za-z0-9]+/gi,          // Sentry auth tokens
  /eyJ[A-Za-z0-9_\-.]{20,}/gi,      // JWTs (header.payload.signature)
];

// =============================================
// INITIALISATION OPTIONS
// =============================================

/**
 * Build the options object passed to `Sentry.withSentry(...)`.
 *
 * Returns `null` when Sentry should be disabled (no DSN configured, or in
 * a context where Sentry would not be useful). The `withSentry` wrapper
 * MUST handle this case gracefully — see usage in `index.ts`.
 */
export function buildSentryOptions(env: Env): Sentry.CloudflareOptions | null {
  if (!env.SENTRY_DSN) {
    return null;
  }

  return {
    dsn: env.SENTRY_DSN,

    // Release tracking — enables "this bug started in build X" insights.
    // Set via deploy workflow; falls back to a sensible default if unset.
    release: env.SENTRY_RELEASE ?? 'inspectvoice-api@unknown',

    // Distinguishes prod from staging in the Sentry UI
    environment: inferEnvironment(env),

    // Sample 100% of errors. We have low volume — capture everything.
    sampleRate: 1.0,

    // No performance tracing for now — adds overhead and costs we don't need.
    // Re-enable later if we want span-level latency analysis.
    tracesSampleRate: 0,

    // Strict PII control. We tag with internal IDs (user_xxx, org_xxx) only.
    // Names, emails, and IPs never reach Sentry.
    sendDefaultPii: false,

    // Don't auto-attach console.log output — logger.ts already handles
    // structured logging, and console capture would duplicate noise.
    integrations: [],

    // Final scrubbing pass on every event before send — backstop in case
    // anything sensitive slipped through earlier filters.
    beforeSend(event) {
      try {
        return scrubEvent(event);
      } catch {
        // If our scrubber itself throws, drop the event entirely rather
        // than risk leaking unscrubbed data.
        return null;
      }
    },

    // Ignore expected/noisy errors that aren't actionable bugs
    ignoreErrors: IGNORED_ERROR_PATTERNS.map((re) => re.source),
  };
}

// =============================================
// CONTEXT HELPERS
// =============================================

/**
 * Attach the request context (org, user, route, requestId) to the current
 * Sentry scope so any error captured during this request is properly tagged.
 *
 * Safe to call when Sentry is disabled — Sentry SDK no-ops if not initialised.
 */
export function attachRequestContext(ctx: RequestContext): void {
  try {
    Sentry.setUser({ id: ctx.userId });
    Sentry.setTag('org_id', ctx.orgId);
    Sentry.setTag('user_role', ctx.userRole);
    Sentry.setTag('route', `${ctx.method} ${ctx.path}`);
    Sentry.setTag('request_id', ctx.requestId);
  } catch {
    // Sentry not initialised or scope unavailable — non-blocking
  }
}

/**
 * Capture an exception with full context. Use for caught errors that you want
 * surfaced to Sentry without rethrowing.
 *
 * The Worker entry point's outer try/catch already auto-captures via the
 * Sentry middleware — this helper is for INNER catches where you handle the
 * error gracefully but still want visibility.
 */
export function captureError(
  error: unknown,
  context?: {
    readonly module?: string;
    readonly operation?: string;
    readonly metadata?: Record<string, unknown>;
  },
): void {
  try {
    Sentry.withScope((scope) => {
      if (context?.module) scope.setTag('module', context.module);
      if (context?.operation) scope.setTag('operation', context.operation);
      if (context?.metadata) {
        // Scrub metadata before attaching as extra context
        scope.setExtras(scrubObject(context.metadata));
      }
      Sentry.captureException(error);
    });
  } catch {
    // Sentry capture itself failed — fall back to console so we don't
    // lose the original error
    console.error('[Sentry capture failed]', error);
  }
}

/**
 * Capture a non-error message at the given severity. Use for "this happened
 * and is worth knowing about, but isn't an exception" — e.g. webhook
 * signature mismatches, suspicious input rejected at the guard.
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'warning',
  context?: {
    readonly module?: string;
    readonly metadata?: Record<string, unknown>;
  },
): void {
  try {
    Sentry.withScope((scope) => {
      if (context?.module) scope.setTag('module', context.module);
      if (context?.metadata) scope.setExtras(scrubObject(context.metadata));
      scope.setLevel(level);
      Sentry.captureMessage(message);
    });
  } catch {
    // Non-blocking
  }
}

// =============================================
// PII SCRUBBING
// =============================================

/**
 * Recursively scrub a Sentry event for sensitive data before send.
 *
 * What we scrub:
 *   - Authorization, Cookie, and webhook signature headers
 *   - Bearer tokens, JWTs, Stripe keys, webhook secrets in any string
 *   - The full request body (it may contain PII or asset data we don't
 *     want in our error tracker)
 *   - Any extras we previously set (defence in depth)
 *
 * What we keep:
 *   - User ID and org ID (these are internal Clerk IDs — not PII)
 *   - Stack traces and error messages
 *   - URL path and method
 *   - Tags and breadcrumb event types
 */
function scrubEvent(event: Sentry.Event): Sentry.Event {
  // ── Request data ──
  if (event.request) {
    if (event.request.headers) {
      event.request.headers = scrubHeaders(event.request.headers);
    }
    // Drop request bodies entirely — they can contain inspection data,
    // PII in voice transcripts, etc. Sentry doesn't need them.
    if (event.request.data) {
      event.request.data = '[scrubbed]';
    }
    if (event.request.cookies) {
      event.request.cookies = '[scrubbed]';
    }
    if (event.request.query_string) {
      // Query strings can contain tokens (magic links etc.) — scrub values
      event.request.query_string = scrubString(
        typeof event.request.query_string === 'string'
          ? event.request.query_string
          : JSON.stringify(event.request.query_string),
      );
    }
  }

  // ── Exception messages ──
  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (exception.value) {
        exception.value = scrubString(exception.value);
      }
    }
  }

  // ── Breadcrumbs ──
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: crumb.message ? scrubString(crumb.message) : crumb.message,
      data: crumb.data ? scrubObject(crumb.data) : crumb.data,
    }));
  }

  // ── Extras (anything we attached via setExtras) ──
  if (event.extra) {
    event.extra = scrubObject(event.extra);
  }

  return event;
}

/** Scrub a headers map — case-insensitive on names */
function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.includes(name.toLowerCase())) {
      scrubbed[name] = '[scrubbed]';
    } else {
      scrubbed[name] = scrubString(value);
    }
  }
  return scrubbed;
}

/** Replace any matches of known secret patterns inside a string */
function scrubString(value: string): string {
  let result = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, '[scrubbed]');
  }
  return result;
}

/** Recursively scrub a generic object — used for breadcrumb data and extras */
function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_HEADER_NAMES.includes(key.toLowerCase())) {
      scrubbed[key] = '[scrubbed]';
      continue;
    }
    if (typeof value === 'string') {
      scrubbed[key] = scrubString(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      scrubbed[key] = scrubObject(value as Record<string, unknown>);
    } else {
      scrubbed[key] = value;
    }
  }
  return scrubbed;
}

// =============================================
// HELPERS
// =============================================

/** Map env hints to a Sentry environment string */
function inferEnvironment(env: Env): string {
  // Staging deployments use a different Worker name (inspectvoice-api-staging)
  // and we infer the environment from the public URL. Production otherwise.
  if (env.WORKERS_PUBLIC_URL?.includes('staging')) return 'staging';
  return 'production';
}

/** Re-export the SDK so the entry point can use `withSentry` directly */
export { Sentry };
