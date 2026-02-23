/**
 * InspectVoice — Error Tracking (Sentry)
 * Initialises Sentry and provides typed error reporting helpers.
 * NEVER logs PII or secrets — scrubs sensitive headers/data.
 */

import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN ?? '';
const IS_PRODUCTION = import.meta.env.PROD;
const APP_VERSION = '0.1.0';

/** Call once in main.tsx before React renders */
export function initErrorTracking(): void {
  if (!SENTRY_DSN) {
    if (IS_PRODUCTION) {
      console.warn('[InspectVoice] VITE_SENTRY_DSN not set — error tracking disabled in production.');
    }
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    release: `inspectvoice@${APP_VERSION}`,
    environment: IS_PRODUCTION ? 'production' : 'development',
    tracesSampleRate: IS_PRODUCTION ? 0.2 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: IS_PRODUCTION ? 0.5 : 0,

    /** Scrub sensitive data before sending to Sentry */
    beforeSend(event) {
      if (event.request?.headers) {
        const sanitised = { ...event.request.headers };
        delete sanitised['Authorization'];
        delete sanitised['Cookie'];
        delete sanitised['X-API-Key'];
        event.request.headers = sanitised;
      }

      if (event.request?.cookies) {
        delete event.request.cookies;
      }

      return event;
    },

    /** Scrub breadcrumbs that might contain tokens */
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
        if (breadcrumb.data?.['url']) {
          const url = String(breadcrumb.data['url']);
          if (url.includes('token=') || url.includes('key=')) {
            breadcrumb.data['url'] = url.replace(
              /([?&])(token|key|secret|password)=[^&]*/gi,
              '$1$2=[REDACTED]'
            );
          }
        }
      }
      return breadcrumb;
    },

    /** Ignore common non-actionable errors */
    ignoreErrors: [
      'ResizeObserver loop',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      'Network request failed',
      'Load failed',
      'AbortError',
      'ChunkLoadError',
    ],
  });
}

// =============================================
// ERROR REPORTING HELPERS
// =============================================

interface ErrorContext {
  /** Which module/feature the error occurred in */
  module: string;
  /** What operation was being attempted */
  operation: string;
  /** Additional context (no PII) */
  metadata?: Record<string, string | number | boolean>;
}

/** Report a caught error with structured context */
export function captureError(error: unknown, context: ErrorContext): void {
  const errorObj = error instanceof Error ? error : new Error(String(error));

  Sentry.withScope((scope) => {
    scope.setTag('module', context.module);
    scope.setTag('operation', context.operation);

    if (context.metadata) {
      scope.setContext('metadata', context.metadata);
    }

    Sentry.captureException(errorObj);
  });

  if (!IS_PRODUCTION) {
    console.error(`[${context.module}:${context.operation}]`, errorObj, context.metadata);
  }
}

/** Report a non-error warning (e.g. unexpected state) */
export function captureWarning(message: string, context: ErrorContext): void {
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setTag('module', context.module);
    scope.setTag('operation', context.operation);

    if (context.metadata) {
      scope.setContext('metadata', context.metadata);
    }

    Sentry.captureMessage(message);
  });

  if (!IS_PRODUCTION) {
    console.warn(`[${context.module}:${context.operation}]`, message, context.metadata);
  }
}

/** Set user context for error reports (call after auth) */
export function setErrorTrackingUser(userId: string, orgId: string): void {
  Sentry.setUser({ id: userId });
  Sentry.setTag('org_id', orgId);
}

/** Clear user context (call on sign out) */
export function clearErrorTrackingUser(): void {
  Sentry.setUser(null);
}

/** Wrap an async operation with automatic error capture */
export async function withErrorTracking<T>(
  fn: () => Promise<T>,
  context: ErrorContext,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    captureError(error, context);
    throw error;
  }
}
