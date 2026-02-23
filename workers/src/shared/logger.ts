/**
 * InspectVoice — Structured Logger
 * Consistent JSON logging for Cloudflare Workers.
 *
 * All log output goes through this module to ensure:
 * - Structured JSON format (parseable by log aggregators)
 * - Request tracing via requestId
 * - Tenant context (orgId, userId) on every log line
 * - PII scrubbing (never log tokens, secrets, or personal data)
 * - Severity levels for filtering
 *
 * Cloudflare Workers logs are available via:
 * - `wrangler tail` (real-time)
 * - Workers Analytics Engine
 * - Third-party log drain (Datadog, etc)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import type { RequestContext, WebhookContext } from '../types';

// =============================================
// LOG LEVELS
// =============================================

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/** Numeric severity for filtering (higher = more severe) */
const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

// =============================================
// LOG ENTRY SHAPE
// =============================================

interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly requestId: string;
  readonly service: 'inspectvoice-api';

  // Context (optional — present when available)
  readonly userId?: string;
  readonly orgId?: string;
  readonly method?: string;
  readonly path?: string;

  // Structured data (optional)
  readonly data?: Record<string, string | number | boolean | null | undefined>;

  // Error details (optional — only on ERROR level)
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
  };

  // Performance (optional)
  readonly latencyMs?: number;
  readonly statusCode?: number;
}

// =============================================
// PII SCRUBBING
// =============================================

/** Keys that must never appear in log data */
const SCRUBBED_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'password',
  'token',
  'secret',
  'api_key',
  'apikey',
  'api-key',
  'stripe_secret',
  'webhook_secret',
  'email',
  'phone',
  'ip_address',
  'signature_ip_address',
]);

/**
 * Scrub PII and sensitive values from a data object.
 * Returns a new object with sensitive keys replaced by '[REDACTED]'.
 */
function scrubSensitiveData(
  data: Record<string, unknown>,
): Record<string, string | number | boolean | null | undefined> {
  const scrubbed: Record<string, string | number | boolean | null | undefined> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    if (SCRUBBED_KEYS.has(lowerKey)) {
      scrubbed[key] = '[REDACTED]';
      continue;
    }

    // Scrub any value that looks like a token or secret
    if (typeof value === 'string' && value.length > 20 && looksLikeSecret(value)) {
      scrubbed[key] = '[REDACTED]';
      continue;
    }

    // Only allow primitive types in log output
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null ||
      value === undefined
    ) {
      scrubbed[key] = value;
    } else {
      // Complex objects get stringified summary, not full dump
      scrubbed[key] = `[${typeof value}]`;
    }
  }

  return scrubbed;
}

/**
 * Heuristic check for values that look like secrets/tokens.
 * Catches Bearer tokens, API keys, JWTs, etc.
 */
function looksLikeSecret(value: string): boolean {
  // JWT pattern (three base64 segments separated by dots)
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return true;
  }
  // Starts with common secret prefixes
  if (/^(sk_|pk_|whsec_|svix_|Bearer\s)/i.test(value)) {
    return true;
  }
  return false;
}

// =============================================
// LOGGER CLASS
// =============================================

export class Logger {
  private readonly requestId: string;
  private readonly userId: string | undefined;
  private readonly orgId: string | undefined;
  private readonly method: string | undefined;
  private readonly path: string | undefined;
  private readonly startedAt: number | undefined;

  /**
   * Create a logger instance from a request context.
   * Use `Logger.fromContext()` or `Logger.fromWebhookContext()` for convenience.
   */
  constructor(opts: {
    requestId: string;
    userId?: string;
    orgId?: string;
    method?: string;
    path?: string;
    startedAt?: number;
  }) {
    this.requestId = opts.requestId;
    this.userId = opts.userId;
    this.orgId = opts.orgId;
    this.method = opts.method;
    this.path = opts.path;
    this.startedAt = opts.startedAt;
  }

  /** Create logger from authenticated request context */
  static fromContext(ctx: RequestContext): Logger {
    return new Logger({
      requestId: ctx.requestId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      method: ctx.method,
      path: ctx.path,
      startedAt: ctx.startedAt,
    });
  }

  /** Create logger from webhook context (no auth) */
  static fromWebhookContext(ctx: WebhookContext): Logger {
    return new Logger({
      requestId: ctx.requestId,
      method: ctx.method,
      path: ctx.path,
      startedAt: ctx.startedAt,
    });
  }

  /** Create a minimal logger for startup/queue contexts */
  static minimal(requestId: string): Logger {
    return new Logger({ requestId });
  }

  // ── Log Methods ──

  debug(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.WARN, message, data);
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    this.emit(LogLevel.ERROR, message, data, error);
  }

  /**
   * Log a completed HTTP request with status and latency.
   * Call this in the router after the response is built.
   */
  logRequest(statusCode: number): void {
    const latencyMs = this.startedAt ? Date.now() - this.startedAt : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: statusCode >= 500 ? LogLevel.ERROR : statusCode >= 400 ? LogLevel.WARN : LogLevel.INFO,
      message: `${this.method ?? 'UNKNOWN'} ${this.path ?? '/'} → ${statusCode}`,
      requestId: this.requestId,
      service: 'inspectvoice-api',
      userId: this.userId,
      orgId: this.orgId,
      method: this.method,
      path: this.path,
      statusCode,
      latencyMs,
    };

    this.write(entry);
  }

  // ── Internal ──

  private emit(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: unknown,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      requestId: this.requestId,
      service: 'inspectvoice-api',
      userId: this.userId,
      orgId: this.orgId,
      method: this.method,
      path: this.path,
      latencyMs: this.startedAt ? Date.now() - this.startedAt : undefined,
    };

    // Attach scrubbed data if provided
    if (data && Object.keys(data).length > 0) {
      (entry as unknown as Record<string, unknown>)['data'] = scrubSensitiveData(data);
    }

    // Attach error details if provided (never log full stack in production for 4xx)
    if (error) {
      const errorInfo = extractErrorInfo(error);
      (entry as unknown as Record<string, unknown>)['error'] = errorInfo;
    }

    this.write(entry);
  }

  private write(entry: LogEntry): void {
    const json = JSON.stringify(entry);

    // Use appropriate console method for Cloudflare Workers log level routing
    const severity = LOG_LEVEL_SEVERITY[entry.level];
    if (severity >= LOG_LEVEL_SEVERITY[LogLevel.ERROR]) {
      console.error(json);
    } else if (severity >= LOG_LEVEL_SEVERITY[LogLevel.WARN]) {
      console.warn(json);
    } else {
      console.log(json);
    }
  }
}

// =============================================
// ERROR EXTRACTION
// =============================================

/**
 * Safely extract error info for logging.
 * Never includes PII or secrets from error messages.
 */
function extractErrorInfo(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      // Include stack in development-like contexts but truncate for production
      stack: error.stack ? truncateStack(error.stack) : undefined,
    };
  }

  if (typeof error === 'string') {
    return { name: 'Error', message: error };
  }

  return { name: 'UnknownError', message: 'An unknown error occurred' };
}

/**
 * Truncate stack trace to a reasonable length.
 * Cloudflare Workers log size limits mean we can't dump entire stacks.
 */
function truncateStack(stack: string): string {
  const lines = stack.split('\n');
  // Keep first 8 lines max — enough to identify the source
  const truncated = lines.slice(0, 8);
  if (lines.length > 8) {
    truncated.push(`  ... (${lines.length - 8} more frames)`);
  }
  return truncated.join('\n');
}

// =============================================
// CONVENIENCE: STANDALONE LOG FUNCTIONS
// =============================================

/**
 * Quick standalone log for contexts where creating a Logger instance is overkill.
 * Prefer Logger.fromContext() in route handlers.
 */
export function logInfo(requestId: string, message: string, data?: Record<string, unknown>): void {
  Logger.minimal(requestId).info(message, data);
}

export function logWarn(requestId: string, message: string, data?: Record<string, unknown>): void {
  Logger.minimal(requestId).warn(message, data);
}

export function logError(requestId: string, message: string, error?: unknown, data?: Record<string, unknown>): void {
  Logger.minimal(requestId).error(message, error, data);
}
