/**
 * InspectVoice — Auth Token Provider
 * src/components/AuthTokenProvider.tsx
 *
 * Bridges Clerk's useAuth() hook to the module-level token getter
 * used by secureFetch, and starts the background sync service.
 *
 * CRITICAL: Children are not rendered until the auth bridge is
 * established. This prevents a race condition where useFetch fires
 * before the token getter is registered — causing unauthenticated
 * API calls that return empty data (especially after PWA reinstall).
 *
 * Place inside <ClerkProvider> but outside <BrowserRouter>.
 *
 * Build Standard: Autaimate v3
 */

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { setTokenGetter } from '@utils/authToken';
import { syncService } from '@services/syncService';

export function AuthTokenProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { getToken, isLoaded } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;

    setTokenGetter(getToken);
    syncService.start(getToken);
    setReady(true);

    return () => {
      syncService.stop();
      setReady(false);
    };
  }, [getToken, isLoaded]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0B0E13]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#22C55E]/30 border-t-[#22C55E] rounded-full animate-spin" />
          <p className="text-sm text-[#6B7280]">Initialising…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
