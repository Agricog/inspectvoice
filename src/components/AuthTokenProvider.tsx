/**
 * InspectVoice — Auth Token Provider
 * src/components/AuthTokenProvider.tsx
 *
 * Renders nothing visible. Bridges Clerk's useAuth() hook to the
 * module-level token getter used by secureFetch, and starts the
 * background sync service once auth is ready.
 *
 * Place inside <ClerkProvider> but outside <BrowserRouter>.
 *
 * Build Standard: Autaimate v3
 */
import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { setTokenGetter } from '@utils/authToken';
import { syncService } from '@services/syncService';

export function AuthTokenProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { getToken } = useAuth();

  useEffect(() => {
    setTokenGetter(getToken);

    // Start the background sync engine with Clerk's token getter
    syncService.start(getToken);

    return () => {
      syncService.stop();
    };
  }, [getToken]);

  return <>{children}</>;
}
