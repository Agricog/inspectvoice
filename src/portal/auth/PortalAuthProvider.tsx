/**
 * InspectVoice — Portal Auth Provider
 * src/portal/auth/PortalAuthProvider.tsx
 *
 * Wraps Clerk for the client portal.
 * Uses VITE_PORTAL_CLERK_PUBLISHABLE_KEY (different from inspector Clerk).
 *
 * Drop-in: wrap your portal routes with <PortalAuthProvider>.
 */

import { ClerkProvider, SignIn, useAuth, useUser } from '@clerk/clerk-react';
import { type ReactNode, useEffect } from 'react';
import { setPortalAuth } from '../api/portalApi';

const PORTAL_CLERK_KEY = import.meta.env.VITE_PORTAL_CLERK_PUBLISHABLE_KEY || '';

interface Props {
  children: ReactNode;
}

/** Top-level provider — put this around your portal router */
export function PortalAuthProvider({ children }: Props) {
  if (!PORTAL_CLERK_KEY) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-red-600 font-medium">Portal Clerk key not configured.</p>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={PORTAL_CLERK_KEY}>
      <PortalAuthGate>{children}</PortalAuthGate>
    </ClerkProvider>
  );
}

/** Gate: if not signed in → show sign-in, otherwise render children */
function PortalAuthGate({ children }: Props) {
  const { isSignedIn, isLoaded, getToken } = useAuth();

  // Wire the token getter into the API client once
  useEffect(() => {
    if (isSignedIn && getToken) {
      setPortalAuth(getToken);
    }
  }, [isSignedIn, getToken]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Client Portal</h1>
            <p className="text-sm text-gray-500 mt-1">Sign in to view your inspection data</p>
          </div>
          <SignIn routing="hash" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/** Hook: get current portal user info */
export function usePortalUser() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return {
    name: user?.fullName ?? user?.firstName ?? 'User',
    email: user?.primaryEmailAddress?.emailAddress ?? '',
    avatarUrl: user?.imageUrl ?? null,
    getToken,
  };
}
