/**
 * InspectVoice — Auth Token Provider
 * src/components/AuthTokenProvider.tsx
 *
 * Renders nothing visible. Bridges Clerk's useAuth() hook to the
 * module-level token getter used by secureFetch.
 *
 * Place inside <ClerkProvider> but outside <BrowserRouter>.
 *
 * Build Standard: Autaimate v3
 */

import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { setTokenGetter } from '@utils/authToken';

export function AuthTokenProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { getToken } = useAuth();

  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);

  return <>{children}</>;
}
