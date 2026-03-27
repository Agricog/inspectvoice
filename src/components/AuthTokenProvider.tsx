/**
 * InspectVoice — Auth Token Provider
 * Bridges Clerk's useAuth() to secureFetch and starts sync.
 *
 * OFFLINE RESILIENCE:
 *   - If Clerk loads within 3 seconds: normal auth flow, session cached.
 *   - If Clerk doesn't load (offline): falls back to cached session.
 *   - Cached session lets the app render for offline inspection capture.
 *   - API calls will fail gracefully; all data is in IndexedDB.
 *
 * Build Standard: Autaimate v3
 */
import { useState, useEffect, useRef } from 'react';
import { useAuth, useUser, useOrganization } from '@clerk/clerk-react';
import { setTokenGetter } from '@utils/authToken';
import { syncService } from '@services/syncService';
import { cacheAuthSession, getCachedSession } from '@services/offlineAuth';

/** How long to wait for Clerk before falling back to cached session */
const CLERK_TIMEOUT_MS = 3_000;

export function AuthTokenProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { getToken, isLoaded: authLoaded } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const [ready, setReady] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  // ── Normal path: Clerk loaded successfully ──
  useEffect(() => {
    if (!authLoaded || initializedRef.current) return;

    initializedRef.current = true;

    // Clear the timeout — Clerk loaded in time
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setTokenGetter(getToken);
    syncService.start(getToken);
    setReady(true);
  }, [authLoaded, getToken]);

  // ── Cache session when user + org are available ──
  useEffect(() => {
    if (!userLoaded || !orgLoaded || !user || !organization) return;

    cacheAuthSession({
      userId: user.id,
      orgId: organization.id,
      orgName: organization.name,
      userName: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Inspector',
      cachedAt: new Date().toISOString(),
    });
  }, [userLoaded, orgLoaded, user, organization]);

  // ── Timeout path: Clerk didn't load, fall back to cached session ──
  useEffect(() => {
    if (ready) return; // Already loaded normally

    timeoutRef.current = setTimeout(() => {
      if (initializedRef.current) return; // Clerk loaded just in time

      const cached = getCachedSession();
      if (cached) {
        // Provide a dummy token getter that returns null (API calls will fail gracefully)
        setTokenGetter(async () => null);
        setOfflineMode(true);
        setReady(true);
        console.info('[Auth] Clerk timeout — using cached session for offline mode');
      }
      // If no cached session, keep showing spinner — user has never signed in
    }, CLERK_TIMEOUT_MS);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [ready]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-iv-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-iv-accent/30 border-t-iv-accent rounded-full animate-spin" />
          <p className="text-sm iv-muted">
            {offlineMode ? 'Loading offline…' : 'Initialising…'}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
