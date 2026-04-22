/**
 * InspectVoice — App Routes
 *
 * Routes array for vite-react-ssg. Public marketing pages (/, /privacy, /terms)
 * are eagerly imported and pre-rendered to static HTML at build time.
 * All authenticated routes are lazy-loaded so their Clerk/browser-API
 * dependencies never execute during SSG.
 *
 * Architecture:
 *   - RootLayout wraps app in HelmetProvider (SSG + client)
 *   - ClientShell wraps children in ClerkProvider + AuthTokenProvider (client only)
 *   - AuthGate + OrgGate enforce sign-in and active org on protected routes
 *
 * Build Standard: Autaimate v3
 */

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import type { RouteRecord } from 'vite-react-ssg';
import {
  SignIn,
  SignUp,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  OrganizationSwitcher,
  ClerkProvider,
  useOrganization,
  useAuth,
} from '@clerk/clerk-react';
import { Layout } from '@components/Layout';
import { PWAUpdatePrompt } from '@components/PWAUpdatePrompt';
import { AuthTokenProvider } from '@components/AuthTokenProvider';
import { getCachedSession } from '@services/offlineAuth';

// ─── Eager: SSG pre-rendered public pages ───
import LandingPage from '@pages/LandingPage';
import PrivacyPage from '@pages/PrivacyPage';
import TermsPage from '@pages/TermsPage';

// =============================================
// ROOT LAYOUT — Helmet (SSG-safe) + client shell
// =============================================

function RootLayout(): JSX.Element {
  return (
    <HelmetProvider>
      <ClientShell>
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </ClientShell>
    </HelmetProvider>
  );
}

function ClientShell({ children }: { children: ReactNode }): JSX.Element {
  // During SSG: skip client-only providers, render children directly.
  // ClerkProvider, AuthTokenProvider, and PWAUpdatePrompt all require
  // browser APIs and are only mounted at runtime.
  if (import.meta.env.SSR) {
    return <>{children}</>;
  }

  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
    | string
    | undefined;

  if (!publishableKey) {
    throw new Error(
      'Missing VITE_CLERK_PUBLISHABLE_KEY environment variable. ' +
        'Set it in Railway and redeploy (Vite bakes env vars at build time).'
    );
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      <AuthTokenProvider>
        <PWAUpdatePrompt />
        {children}
      </AuthTokenProvider>
    </ClerkProvider>
  );
}

// =============================================
// ORG GATE — requires active organisation
// =============================================

function OrgGate({ children }: { children: ReactNode }): JSX.Element {
  const { organization, isLoaded } = useOrganization();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-iv-bg">
        <div className="animate-pulse text-iv-muted text-sm">Loading…</div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-iv-bg gap-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-iv-text mb-2">
            Select Organisation
          </h1>
          <p className="text-sm text-iv-muted">
            Choose or create an organisation to continue.
          </p>
        </div>
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/dashboard"
          afterCreateOrganizationUrl="/dashboard"
        />
      </div>
    );
  }

  return <>{children}</>;
}

// =============================================
// AUTH GATE — wraps protected content
// =============================================

function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { isLoaded } = useAuth();
  const cachedSession = getCachedSession();
  const isOffline = !navigator.onLine;

  if (isLoaded) {
    return (
      <>
        <SignedIn>
          <OrgGate>{children}</OrgGate>
        </SignedIn>
        <SignedOut>
          <RedirectToSignIn />
        </SignedOut>
      </>
    );
  }

  if (isOffline && cachedSession) {
    return <>{children}</>;
  }

  return <></>;
}

// =============================================
// HOME ROUTE — SSG-safe, redirects signed-in users client-side
// =============================================

function HomeRoute(): JSX.Element {
  // During SSG: always render LandingPage — no Clerk context available.
  // On client: HomeRouteClient handles signed-in redirect without hydration mismatch.
  if (import.meta.env.SSR) {
    return <LandingPage />;
  }
  return <HomeRouteClient />;
}

function HomeRouteClient(): JSX.Element {
  const { isLoaded, isSignedIn } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(timer);
  }, [isLoaded]);

  if (isLoaded) {
    if (isSignedIn) {
      return <Navigate to="/dashboard" replace />;
    }
    return <LandingPage />;
  }

  // Offline with cached session — fast-path to dashboard
  if (timedOut || !navigator.onLine) {
    const cached = getCachedSession();
    if (cached) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // While Clerk initialises: render LandingPage so hydration matches SSG output
  return <LandingPage />;
}

// =============================================
// SIGN-IN / SIGN-UP WRAPPERS
// =============================================

function SignInRoute(): JSX.Element {
  return (
    <div className="flex items-center justify-center min-h-screen bg-iv-bg">
      <SignIn routing="path" path="/sign-in" />
    </div>
  );
}

function SignUpRoute(): JSX.Element {
  return (
    <div className="flex items-center justify-center min-h-screen bg-iv-bg">
      <SignUp routing="path" path="/sign-up" />
    </div>
  );
}

// =============================================
// 404
// =============================================

function NotFound(): JSX.Element {
  return (
    <div className="text-center py-16">
      <h1 className="text-4xl font-bold text-iv-muted-2 mb-2">404</h1>
      <p className="text-sm text-iv-muted">Page not found.</p>
    </div>
  );
}

// =============================================
// ROUTES — exported for vite-react-ssg
// =============================================

export const routes: RouteRecord[] = [
  {
    path: '/',
    element: <RootLayout />,
    children: [
      // ─── Public (SSG pre-rendered) ───
      { index: true, element: <HomeRoute /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'terms', element: <TermsPage /> },

      // ─── Public (client-only — Clerk dependency) ───
      { path: 'sign-in/*', element: <SignInRoute /> },
      { path: 'sign-up/*', element: <SignUpRoute /> },
      {
        path: 'verify/:bundleId',
        lazy: async () => {
          const mod = await import('@pages/VerifyPage');
          return { Component: mod.default };
        },
      },
      {
        path: 'performance-share/:token',
        lazy: async () => {
          const mod = await import('@pages/PerformanceSharePage');
          return { Component: mod.default };
        },
      },

      // ─── Protected (AuthGate + Layout, all lazy-loaded) ───
      {
        element: (
          <AuthGate>
            <Layout />
          </AuthGate>
        ),
        children: [
          {
            path: 'dashboard',
            lazy: async () => {
              const { ManagerDashboard } = await import('@pages/ManagerDashboard');
              return { Component: ManagerDashboard };
            },
          },
          {
            path: 'sites',
            lazy: async () => {
              const { SiteList } = await import('@pages/SiteList');
              return { Component: SiteList };
            },
          },
          {
            path: 'sites/new',
            lazy: async () => {
              const { SiteForm } = await import('@pages/SiteForm');
              return { Component: SiteForm };
            },
          },
          {
            path: 'sites/:id',
            lazy: async () => {
              const { SiteDetail } = await import('@pages/SiteDetail');
              return { Component: SiteDetail };
            },
          },
          {
            path: 'sites/:id/edit',
            lazy: async () => {
              const { SiteForm } = await import('@pages/SiteForm');
              return { Component: SiteForm };
            },
          },
          {
            path: 'sites/:siteId/assets/new',
            lazy: async () => {
              const mod = await import('@pages/AssetForm');
              return { Component: mod.default };
            },
          },
          {
            path: 'sites/:siteId/assets/:assetId',
            lazy: async () => {
              const mod = await import('@pages/AssetDetail');
              return { Component: mod.default };
            },
          },
          {
            path: 'sites/:siteId/assets/:assetId/edit',
            lazy: async () => {
              const mod = await import('@pages/AssetForm');
              return { Component: mod.default };
            },
          },
          {
            path: 'sites/:siteId/inspect/new',
            lazy: async () => {
              const mod = await import('@pages/InspectionStart');
              return { Component: mod.default };
            },
          },
          {
            path: 'sites/:siteId/inspections/:inspectionId/review',
            lazy: async () => {
              const mod = await import('@pages/InspectionReview');
              return { Component: mod.default };
            },
          },
          {
            path: 'sites/:siteId/inspections/:inspectionId/capture',
            lazy: async () => {
              const mod = await import('@pages/InspectionCapture');
              return { Component: mod.default };
            },
          },
          {
            path: 'inspections',
            lazy: async () => {
              const { InspectionList } = await import('@pages/InspectionList');
              return { Component: InspectionList };
            },
          },
          {
            path: 'defects',
            lazy: async () => {
              const { DefectTracker } = await import('@pages/DefectTracker');
              return { Component: DefectTracker };
            },
          },
          {
            path: 'incidents',
            lazy: async () => {
              const mod = await import('@pages/IncidentList');
              return { Component: mod.default };
            },
          },
          {
            path: 'incidents/new',
            lazy: async () => {
              const mod = await import('@pages/IncidentForm');
              return { Component: mod.default };
            },
          },
          {
            path: 'incidents/:id',
            lazy: async () => {
              const mod = await import('@pages/IncidentForm');
              return { Component: mod.default };
            },
          },
          {
            path: 'sealed-exports',
            lazy: async () => {
              const mod = await import('@pages/SealedExportsPage');
              return { Component: mod.default };
            },
          },
          {
            path: 'normalisation-history',
            lazy: async () => {
              const mod = await import('@pages/NormalisationHistoryPage');
              return { Component: mod.default };
            },
          },
          {
            path: 'settings',
            lazy: async () => {
              const { SettingsPage } = await import('@pages/SettingsPage');
              return { Component: SettingsPage };
            },
          },
          {
            path: 'route-planner',
            lazy: async () => {
              const mod = await import('@pages/RoutePlanner');
              return { Component: mod.default };
            },
          },
          {
            path: 'portal/*',
            lazy: async () => {
              const { PortalRouter } = await import('./portal/PortalRouter');
              return { Component: PortalRouter };
            },
          },
          {
            path: 'inspector-performance',
            lazy: async () => {
              const mod = await import('@pages/InspectorPerformancePage');
              return { Component: mod.default };
            },
          },
          {
            path: 'inspector-performance/:userId',
            lazy: async () => {
              const mod = await import('@pages/InspectorDetailPage');
              return { Component: mod.default };
            },
          },
          {
            path: 'my-performance',
            lazy: async () => {
              const mod = await import('@pages/MyPerformancePage');
              return { Component: mod.default };
            },
          },
          {
            path: 'defect-library',
            lazy: async () => {
              const mod = await import('@pages/DefectLibraryPage');
              return { Component: mod.default };
            },
          },
          {
            path: 'recalls',
            lazy: async () => {
              const mod = await import('@pages/RecallsPage');
              return { Component: mod.default };
            },
          },
        ],
      },

      // Catch-all 404
      { path: '*', element: <NotFound /> },
    ],
  },
];
