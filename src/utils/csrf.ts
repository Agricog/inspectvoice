/**
 * InspectVoice — CSRF Token Management
 * Generates and validates CSRF tokens for state-changing requests.
 * Tokens are per-session, stored in sessionStorage.
 *
 * Usage:
 *   - Frontend: Include token in request header via getCSRFToken()
 *   - Worker: Validate token from X-CSRF-Token header
 *
 * Note: Primary auth is Clerk JWT (bearer token).
 * CSRF adds defence-in-depth against cross-origin state mutation.
 */

const CSRF_STORAGE_KEY = 'iv-csrf-token';
const CSRF_HEADER_NAME = 'X-CSRF-Token';
const TOKEN_BYTE_LENGTH = 32;

/**
 * Generate a cryptographically random CSRF token.
 * Uses crypto.getRandomValues (available in all modern browsers + Workers).
 */
function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get the current session's CSRF token.
 * Creates one if it doesn't exist yet.
 */
export function getCSRFToken(): string {
  try {
    let token = sessionStorage.getItem(CSRF_STORAGE_KEY);

    if (!token) {
      token = generateToken();
      sessionStorage.setItem(CSRF_STORAGE_KEY, token);
    }

    return token;
  } catch {
    // sessionStorage unavailable (private browsing, storage full)
    // Fall back to in-memory token (valid for page lifetime only)
    return generateToken();
  }
}

/**
 * Get the CSRF header name for use in fetch requests.
 */
export function getCSRFHeaderName(): string {
  return CSRF_HEADER_NAME;
}

/**
 * Build CSRF headers for inclusion in fetch requests.
 * Only needed for state-changing methods (POST, PUT, PATCH, DELETE).
 */
export function getCSRFHeaders(): Record<string, string> {
  return {
    [CSRF_HEADER_NAME]: getCSRFToken(),
  };
}

/**
 * Check if a request method requires CSRF protection.
 */
export function requiresCSRF(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE';
}

/**
 * Clear CSRF token (call on sign-out).
 */
export function clearCSRFToken(): void {
  try {
    sessionStorage.removeItem(CSRF_STORAGE_KEY);
  } catch {
    // sessionStorage unavailable — no-op
  }
}
