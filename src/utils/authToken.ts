/**
 * InspectVoice — Auth Token Bridge
 * src/utils/authToken.ts
 *
 * Bridges Clerk's useAuth().getToken (React hook) to secureFetch (plain function).
 *
 * Flow:
 *   1. AuthTokenProvider component (near app root) calls setTokenGetter()
 *      with Clerk's getToken function
 *   2. secureFetch calls getAuthToken() on every request
 *   3. Token is fetched fresh each time (Clerk handles caching/refresh)
 *
 * This avoids every secureFetch caller needing to pass getToken manually.
 *
 * Build Standard: Autaimate v3
 */

type TokenGetter = () => Promise<string | null>;

let _getToken: TokenGetter | null = null;

/**
 * Called once by AuthTokenProvider to register Clerk's getToken function.
 */
export function setTokenGetter(getter: TokenGetter): void {
  _getToken = getter;
}

/**
 * Called by secureFetch on every request to get the current JWT.
 * Returns null if no token getter is registered (pre-auth).
 */
export async function getAuthToken(): Promise<string | null> {
  if (!_getToken) return null;
  return _getToken();
}
