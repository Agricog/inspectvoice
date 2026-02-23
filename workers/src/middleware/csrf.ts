/**
 * InspectVoice — CSRF Middleware (Server-Side)
 * Validates CSRF tokens on state-changing requests.
 *
 * Strategy: Double-submit pattern.
 * The frontend generates a CSRF token per session (stored in sessionStorage)
 * and sends it via the X-CSRF-Token header on POST/PUT/PATCH/DELETE.
 * This middleware validates the token is present and non-empty.
 *
 * Since we use Bearer token auth (not cookies), the CSRF risk is lower
 * than cookie-based auth. However, the Build Standard requires CSRF
 * protection as defence-in-depth. The token acts as proof that the
 * request originated from our frontend, not a cross-site script.
 *
 * Build Standard: Autaimate v3 §6 — CSRF tokens on state-changing operations
 */

import { BadRequestError } from '../shared/errors';

// =============================================
// CSRF HEADER NAME
// =============================================

/** Must match the frontend csrf.ts header name exactly */
const CSRF_HEADER = 'X-CSRF-Token';

/** Minimum token length to accept (prevents empty/trivial tokens) */
const MIN_TOKEN_LENGTH = 16;

/** Maximum token length (prevents abuse via oversized headers) */
const MAX_TOKEN_LENGTH = 256;

// =============================================
// VALIDATION
// =============================================

/**
 * Validate the CSRF token on state-changing requests.
 * Throws BadRequestError if the token is missing or invalid.
 *
 * Only validates on POST, PUT, PATCH, DELETE.
 * GET, HEAD, OPTIONS are exempt (safe methods).
 *
 * @param request — incoming Request
 * @throws BadRequestError if CSRF token is missing or invalid
 */
export function validateCsrf(request: Request): void {
  const method = request.method.toUpperCase();

  // Safe methods don't need CSRF protection
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return;
  }

  const token = request.headers.get(CSRF_HEADER);

  if (!token) {
    throw new BadRequestError('Missing CSRF token');
  }

  if (token.length < MIN_TOKEN_LENGTH) {
    throw new BadRequestError('Invalid CSRF token');
  }

  if (token.length > MAX_TOKEN_LENGTH) {
    throw new BadRequestError('Invalid CSRF token');
  }

  // Token format validation — must be alphanumeric/hex (no special chars)
  if (!/^[a-zA-Z0-9_-]+$/.test(token)) {
    throw new BadRequestError('Invalid CSRF token format');
  }
}
