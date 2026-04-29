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
 * AUTH HEALTH PROBE (Step 4):
 *   - When Clerk reports loaded + signed in, we fire a single probe call
 *     to /api/v1/users/me before rendering the app.
 *   - If the probe returns 401, recovery fires immediately and the user
 *     lands on /sign-in instead of seeing "Failed to load..." everywhere.
 *   - This catches the wedge state where Clerk thinks there's a session
 *     but getToken() returns null or a stale/invalid JWT.
 *
 * FIX: 31 Mar 2026 — Removed initializedRef gate so sign-out/sign-in
 *   correctly re-initialises the token getter and sync service.
 *
 * Build Standard: Autaimate v3
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth, useUser, useOrganization } from '@clerk/clerk-react';
import { setTokenGetter } from '@utils/authToken';
import { syncService } from '@services/syncService';
import { cacheAuthSession, getCachedSession } from '@services/offlineAuth';
import { recoverFromAuthFailure } from '@services/authRecovery';
import { secureFetch, FetchError } from '@hooks/useFetch';
import {
  captureWarning,
  setErrorTrackingUser,
  clearErrorTrackingUser,
} from '@utils/errorTracking';

/** How long to wait for Clerk before falling back to cached session */
const CLERK_TIMEOUT_MS = 3_000;

/** How long to wait for the auth probe before treating it as failed */
const PROBE_TIMEOUT_MS = 8_000;

export function AuthTokenProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { getToken, isLoaded: authLoaded, userId } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const [ready, setReady] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const probeFiredForUserRef = useRef<string | null>(null);

  // Stable token getter that always uses the latest getToken from Clerk
  const stableGetToken = useCallback(async () => {
    try {
      return await getToken();
    } catch {
      return null;
    }
  }, [getToken]);

  // ── Normal path: Clerk loaded successfully ──
  // Re-runs whenever userId changes (sign-out → sign-in)
  useEffect(() => {
    if (!authLoaded) return;

    // Clear the timeout — Clerk loaded in time
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Always update the token getter (handles sign-out/sign-in)
    setTokenGetter(stableGetToken);

    // Only restart sync if user changed (avoids duplicate sync starts)
    if (userId && userId !== lastUserIdRef.current) {
      lastUserIdRef.current = userId;
      syncService.start(stableGetToken);
    }

    // If signed out, clear last user
    if (!userId) {
      lastUserIdRef.current = null;
      probeFiredForUserRef.current = null;
      // No probe needed when signed out — just render (will show sign-in)
      setReady(true);
      return;
    }

    // ── Auth health probe ──
    // Only fire once per userId. Probe verifies that Clerk's reported
    // session can actually mint a working JWT against our API.
    if (probeFiredForUserRef.current === userId) {
      // Already probed for this user — render normally
      setReady(true);
      return;
    }

    probeFiredForUserRef.current = userId;

    // Fire probe but don't block rendering on offline failures.
    // Online + 401 → recovery. Online + ok → render. Offline → render
    // and let the offline path handle it (cached session, etc).
    void probeAuthHealth().then((result) => {
      if (result === 'ok' || result === 'offline') {
        setReady(true);
      }
      // If result === 'auth-failed', recoverFromAuthFailure has already been
      // invoked. The page will reload to /sign-in shortly. Don't set ready.
    });
  }, [authLoaded, userId, stableGetToken]);

  // ── Cache session + tag Sentry with user/org context ──
  useEffect(() => {
    if (!userLoaded || !orgLoaded || !user || !organization) {
      // Signed out or pre-auth — clear any stale Sentry user context
      if (userLoaded && !user) {
        clearErrorTrackingUser();
      }
      return;
    }

    cacheAuthSession({
      userId: user.id,
      orgId: organization.id,
      orgName: organization.name,
      userName: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Inspector',
      cachedAt: new Date().toISOString(),
    });

    // Tag every Sentry event from now on with user + org.
    // This means errors come in with breadcrumb context like
    // "user: user_3CQrR... | org_id: org_3CQrayRX..." — so when Julie hits
    // a bug, you see exactly whose device it happened on without guessing.
    setErrorTrackingUser(user.id, organization.id);
  }, [userLoaded, orgLoaded, user, organization]);

  // ── Timeout path: Clerk didn't load, fall back to cached session ──
  useEffect(() => {
    if (ready) return;

    timeoutRef.current = setTimeout(() => {
      if (ready) return; // Clerk loaded just in time

      const cached = getCachedSession();
      if (cached) {
        setTokenGetter(async () => null);
        setReady(true);
        console.info('[Auth] Clerk timeout — using cached session for offline mode');
      }
      // If no cached session, keep showing splash — user has never signed in
    }, CLERK_TIMEOUT_MS);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [ready]);

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-iv-bg gap-4">
        <div className="w-12 h-12 rounded-xl bg-iv-accent/10 flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-iv-accent">
            <path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
            <path d="M12.02 21.485C6.44 21.485 2 16.97 2 11.4a10 10 0 0 1 20 0c0 2.58-.94 4.93-2.49 6.73" />
            <path d="M8 21l4-4l4 4" />
          </svg>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-iv-accent animate-pulse" />
          <span className="text-sm text-iv-muted">Loading your workspace…</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// =============================================
// AUTH HEALTH PROBE
// =============================================

type ProbeResult = 'ok' | 'auth-failed' | 'offline';

/**
 * Fire a single GET /api/v1/users/me to verify the auth bridge actually works.
 *
 * Outcomes:
 *   - 200 ok           → 'ok'
 *   - 401              → secureFetch already triggered recovery (Step 2).
 *                        We return 'auth-failed' so the provider stops rendering.
 *   - network error    → 'offline' — let the app render in offline mode.
 *   - any other error  → 'offline' — be permissive, app shouldn't be locked
 *                        out by transient server problems.
 */
async function probeAuthHealth(): Promise<ProbeResult> {
  try {
    await Promise.race([
      secureFetch('/api/v1/users/me'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Probe timeout')), PROBE_TIMEOUT_MS),
      ),
    ]);
    return 'ok';
  } catch (error) {
    // 401 — secureFetch already invoked recoverFromAuthFailure. The page is
    // about to reload. Tell the caller not to render the app.
    if (error instanceof FetchError && error.status === 401) {
      return 'auth-failed';
    }

    // Defensive: in case a 401 escapes here without secureFetch handling it
    // (e.g. if Step 2 wasn't applied or was rolled back), trigger recovery
    // ourselves.
    if (error instanceof FetchError && error.status === 401) {
      void recoverFromAuthFailure('AuthTokenProvider:probe-401');
      return 'auth-failed';
    }

    // Any other error (network, timeout, 5xx) — log and treat as offline.
    captureWarning('Auth probe failed (non-401)', {
      module: 'AuthTokenProvider',
      operation: 'probeAuthHealth',
      metadata: {
        status: error instanceof FetchError ? error.status : 0,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
    return 'offline';
  }
}
