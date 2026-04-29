/**
 * InspectVoice — Offline Auth Cache
 * Caches the last valid Clerk session so the app renders offline.
 *
 * When online: Clerk validates normally, session is cached to localStorage.
 * When offline: If Clerk can't load within 3s, cached session is used.
 * The cached token won't work for API calls (expired), but that's fine —
 * offline mode uses IndexedDB for all data. API calls fail gracefully.
 *
 * Build Standard: Autaimate v3
 */

const CACHE_KEY = 'iv-offline-auth';

export interface CachedSession {
  readonly userId: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly userName: string;
  readonly cachedAt: string;
}

export function cacheAuthSession(session: CachedSession): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(session));
  } catch {
    // Storage full or unavailable — non-blocking
  }
}

/** Max age of a cached session before it's considered stale (7 days) */
const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function getCachedSession(): CachedSession | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed['userId'] !== 'string' ||
      typeof parsed['orgId'] !== 'string'
    ) {
      return null;
    }

    // Staleness check — reject sessions older than 7 days.
    // Prevents zombie offline mode resurrecting a session from weeks ago.
    const cachedAt = typeof parsed['cachedAt'] === 'string' ? parsed['cachedAt'] : null;
    if (cachedAt) {
      const cachedAtMs = new Date(cachedAt).getTime();
      if (!Number.isNaN(cachedAtMs) && Date.now() - cachedAtMs > MAX_SESSION_AGE_MS) {
        // Stale — clear it so we don't keep evaluating
        try {
          localStorage.removeItem(CACHE_KEY);
        } catch {
          // Non-blocking
        }
        return null;
      }
    }

    return parsed as unknown as CachedSession;
  } catch {
    return null;
  }
}

export function hasCachedSession(): boolean {
  return getCachedSession() !== null;
}

export function clearCachedSession(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Non-blocking
  }
}
