/**
 * InspectVoice — HTTP Error Classes
 * Typed, throwable errors for consistent API error responses.
 *
 * Usage in route handlers:
 *   throw new NotFoundError('Site not found');
 *   throw new ForbiddenError('Cannot access another tenant\'s data');
 *   throw new ConflictError('Inspection is signed and immutable');
 *
 * The router error boundary catches these and returns the correct
 * HTTP status + standardised JSON error envelope.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

// =============================================
// BASE HTTP ERROR
// =============================================

/**
 * Base class for all HTTP errors.
 * Carries status code and a machine-readable error code.
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;

  constructor(statusCode: number, errorCode: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;

   // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** Alias for backward compatibility */
export { HttpError as AppError };

// =============================================
// CLIENT ERRORS (4xx)
// =============================================

/** 400 — Malformed request, validation failure, bad input */
export class BadRequestError extends HttpError {
  constructor(message: string = 'Bad request') {
    super(400, 'BAD_REQUEST', message);
    this.name = 'BadRequestError';
  }
}

/** 401 — Missing or invalid authentication */
export class UnauthorizedError extends HttpError {
  constructor(message: string = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

/** 403 — Authenticated but not permitted (wrong tenant, wrong role, etc) */
export class ForbiddenError extends HttpError {
  constructor(message: string = 'Access denied') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

/** 404 — Resource does not exist (or doesn't belong to this tenant) */
export class NotFoundError extends HttpError {
  constructor(message: string = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

/** 409 — Conflict with current state (e.g. editing a signed inspection) */
export class ConflictError extends HttpError {
  constructor(message: string = 'Conflict with current state') {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

/** 422 — Request is well-formed but contains semantic errors */
export class UnprocessableEntityError extends HttpError {
  constructor(message: string = 'Unprocessable entity') {
    super(422, 'UNPROCESSABLE_ENTITY', message);
    this.name = 'UnprocessableEntityError';
  }
}

/** 429 — Rate limit exceeded */
export class RateLimitError extends HttpError {
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number = 60, message: string = 'Rate limit exceeded') {
    super(429, 'RATE_LIMITED', message);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// =============================================
// SERVER ERRORS (5xx)
// =============================================

/** 500 — Unexpected server error */
export class InternalError extends HttpError {
  constructor(message: string = 'Internal server error') {
    super(500, 'INTERNAL_ERROR', message);
    this.name = 'InternalError';
  }
}

/** 502 — Upstream service failure (Deepgram, Claude, Neon, Stripe, etc) */
export class BadGatewayError extends HttpError {
  constructor(message: string = 'Upstream service unavailable') {
    super(502, 'BAD_GATEWAY', message);
    this.name = 'BadGatewayError';
  }
}

/** 503 — Service unavailable (READ_ONLY_MODE, maintenance, etc) */
export class ServiceUnavailableError extends HttpError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(503, 'SERVICE_UNAVAILABLE', message);
    this.name = 'ServiceUnavailableError';
  }
}

// =============================================
// ERROR RESPONSE FORMATTER
// =============================================

/**
 * Format any error into a standardised JSON Response.
 * Used by the router error boundary.
 *
 * - HttpError instances → use their status code and error code
 * - Unknown errors → 500 with generic message (never leak internals)
 */
export function formatErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof HttpError) {
    const body: ErrorResponseBody = {
      success: false,
      error: {
        code: error.errorCode,
        message: error.message,
        requestId,
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    };

    // Add Retry-After header for rate limit errors
    if (error instanceof RateLimitError) {
      headers['Retry-After'] = String(error.retryAfterSeconds);
      // Also include in body for frontend consumption (matches CertVoice pattern)
      (body.error as Record<string, unknown>)['retryAfterSeconds'] = error.retryAfterSeconds;
    }

    return new Response(JSON.stringify(body), {
      status: error.statusCode,
      headers,
    });
  }

  // Unknown error — never expose internals to client
  const body: ErrorResponseBody = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    },
  };

  return new Response(JSON.stringify(body), {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    },
  });
}

// =============================================
// ERROR TYPE GUARD
// =============================================

/** Type guard for HttpError instances */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

/** Type guard to check if an error is a specific status code */
export function isErrorWithStatus(error: unknown, statusCode: number): boolean {
  return error instanceof HttpError && error.statusCode === statusCode;
}

// =============================================
// INTERNAL TYPES
// =============================================

interface ErrorResponseBody {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly retryAfterSeconds?: number;
  };
}
