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

export function getCachedSession(): CachedSession | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed['userId'] === 'string' &&
      typeof parsed['orgId'] === 'string'
    ) {
      return parsed as unknown as CachedSession;
    }
    return null;
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
