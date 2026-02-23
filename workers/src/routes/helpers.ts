/**
 * InspectVoice — Route Response Helpers
 * Standardised response builders for all API route handlers.
 *
 * Every response includes:
 * - Content-Type: application/json
 * - X-Request-Id header for tracing
 * - Consistent JSON envelope shape
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

// =============================================
// JSON RESPONSE
// =============================================

/**
 * Create a JSON response with standard headers.
 *
 * @param body — response body (will be JSON.stringify'd)
 * @param requestId — request ID for tracing header
 * @param status — HTTP status code (default: 200)
 * @returns Response
 */
export function jsonResponse(
  body: Record<string, unknown>,
  requestId: string,
  status: number = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
      'Cache-Control': 'no-store',
    },
  });
}

// =============================================
// NO CONTENT RESPONSE
// =============================================

/**
 * 204 No Content response (for updates with no body to return).
 */
export function noContentResponse(requestId: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'X-Request-Id': requestId,
    },
  });
}

// =============================================
// CREATED RESPONSE
// =============================================

/**
 * 201 Created response with the created resource.
 */
export function createdResponse(
  body: Record<string, unknown>,
  requestId: string,
): Response {
  return jsonResponse(body, requestId, 201);
}

// =============================================
// STREAM RESPONSE (for file downloads)
// =============================================

/**
 * Binary/stream response for file downloads (PDF, images, etc).
 */
export function fileResponse(
  body: ReadableStream | ArrayBuffer | Uint8Array,
  requestId: string,
  options: {
    contentType: string;
    filename?: string;
    contentLength?: number;
  },
): Response {
  const headers: Record<string, string> = {
    'Content-Type': options.contentType,
    'X-Request-Id': requestId,
    'Cache-Control': 'private, max-age=3600',
  };

  if (options.filename) {
    headers['Content-Disposition'] = `attachment; filename="${options.filename}"`;
  }

  if (options.contentLength !== undefined) {
    headers['Content-Length'] = String(options.contentLength);
  }

  return new Response(body, {
    status: 200,
    headers,
  });
}

// =============================================
// ACCEPTED RESPONSE (for async operations)
// =============================================

/**
 * 202 Accepted response for operations that are queued for processing.
 * Used for async operations like AI analysis, PDF generation.
 */
export function acceptedResponse(
  body: Record<string, unknown>,
  requestId: string,
): Response {
  return jsonResponse(body, requestId, 202);
}
