/**
 * InspectVoice — App Root
 * Route definitions with Layout shell, Clerk auth gates, and PWA update prompt.
 *
 * UPDATED: Features 14 (Inspector Performance) + 15 (Defect Library) routes added.
 * UPDATED: Landing page at / for SEO, dashboard moved to /dashboard.
 * FIX: 31 Mar 2026 — HomeRoute replaces bare SignedIn/SignedOut on / route
 *   to prevent white screen when Clerk hasn't initialised after sign-in redirect.
 *
 * Build Standard: Autaimate v3
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import {
  SignIn,
  SignUp,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  OrganizationSwitcher,
  useOrganization,
  useAuth,
} from '@clerk/clerk-react';
import { Layout } from '@components/Layout';
import { PWAUpdatePrompt } from '@components/PWAUpdatePrompt';
import { getCachedSession } from '@services/offlineAuth';
import { SiteList } from '@pages/SiteList';
import { SiteForm } from '@pages/SiteForm';
import { SiteDetail } from '@pages/SiteDetail';
import AssetForm from '@pages/AssetForm';
import AssetDetail from '@pages/AssetDetail';
import InspectionStart from '@pages/InspectionStart';
import InspectionReview from '@pages/InspectionReview';
import InspectionCapture from '@pages/InspectionCapture';
import { InspectionList } from '@pages/InspectionList';
import { DefectTracker } from '@pages/DefectTracker';
import { ManagerDashboard } from '@pages/ManagerDashboard';
import { SettingsPage } from '@pages/SettingsPage';
import IncidentList from '@pages/IncidentList';
import IncidentForm from '@pages/IncidentForm';
import VerifyPage from '@pages/VerifyPage';
import SealedExportsPage from '@pages/SealedExportsPage';
import NormalisationHistoryPage from '@pages/NormalisationHistoryPage';
import RoutePlanner from '@pages/RoutePlanner';
import { PortalRouter } from './portal/PortalRouter';

// ── Feature 14: Inspector Performance ──
import InspectorPerformancePage from '@pages/InspectorPerformancePage';
import InspectorDetailPage from '@pages/InspectorDetailPage';
import MyPerformancePage from '@pages/MyPerformancePage';

// ── Feature 15: Defect Library ──
import DefectLibraryPage from '@pages/DefectLibraryPage';

// ── Feature 14: Performance Share (public) ──
import PerformanceSharePage from '@pages/PerformanceSharePage';

// ── Feature 17: Manufacturer Recalls ──
import RecallsPage from '@pages/RecallsPage';

// ── SEO Landing Page ──
import LandingPage from '@pages/LandingPage';

// ── Legal Pages ──
import PrivacyPage from '@pages/PrivacyPage';
import TermsPage from '@pages/TermsPage';

// =============================================
// ORG GATE — requires active organisation
// =============================================

function OrgGate({ children }: { children: React.ReactNode }): JSX.Element {
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
          <h1 className="text-xl font-semibold text-iv-text mb-2">Select Organisation</h1>
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
// AUTH GATE — wraps all protected content
// =============================================

function AuthGate({ children }: { children: React.ReactNode }): JSX.Element {
  const { isLoaded } = useAuth();
  const cachedSession = getCachedSession();
  const isOffline = !navigator.onLine;

  // Clerk loaded — standard auth flow
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

  // Offline with cached session — let them in
  if (isOffline && cachedSession) {
    return <>{children}</>;
  }

// Clerk still loading — splash is already visible from index.html
  return <></>;
}

// =============================================
// HOME ROUTE — handles / with proper loading state
// =============================================

function HomeRoute(): JSX.Element {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
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
          <span className="text-sm text-iv-muted">Loading…</span>
        </div>
      </div>
    );
  }

  if (isSignedIn) {
    return <Navigate to="/dashboard" replace />;
  }

  return <LandingPage />;
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
// APP
// =============================================

export function App(): JSX.Element {
  return (
    <HelmetProvider>
      <BrowserRouter>
        {/* PWA: offline banner, update prompt, offline-ready toast */}
        <PWAUpdatePrompt />

        <Routes>
          {/* ── Public routes (no auth required) ── */}

          {/* Landing / dashboard — splash screen while Clerk initialises */}
          <Route path="/" element={<HomeRoute />} />

          <Route
            path="/sign-in/*"
            element={
              <div className="flex items-center justify-center min-h-screen bg-iv-bg">
                <SignIn routing="path" path="/sign-in" />
              </div>
            }
          />
          <Route
            path="/sign-up/*"
            element={
              <div className="flex items-center justify-center min-h-screen bg-iv-bg">
                <SignUp routing="path" path="/sign-up" />
              </div>
            }
          />

          {/* Public verification — council officers, solicitors, insurers */}
          <Route path="/verify/:bundleId" element={<VerifyPage />} />

          {/* Public performance share — token-scoped, no auth */}
          <Route path="/performance-share/:token" element={<PerformanceSharePage />} />

          {/* Legal pages — public, no auth */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />

          {/* ── Protected routes ── */}
          <Route
            element={
              <AuthGate>
                <Layout />
              </AuthGate>
            }
          >
            {/* Dashboard */}
            <Route path="/dashboard" element={<ManagerDashboard />} />

            {/* Sites */}
            <Route path="/sites" element={<SiteList />} />
            <Route path="/sites/new" element={<SiteForm />} />
            <Route path="/sites/:id" element={<SiteDetail />} />
            <Route path="/sites/:id/edit" element={<SiteForm />} />
            <Route path="/sites/:siteId/assets/new" element={<AssetForm />} />
            <Route path="/sites/:siteId/assets/:assetId" element={<AssetDetail />} />
            <Route path="/sites/:siteId/assets/:assetId/edit" element={<AssetForm />} />
            <Route path="/sites/:siteId/inspect/new" element={<InspectionStart />} />
            <Route path="/sites/:siteId/inspections/:inspectionId/review" element={<InspectionReview />} />
            <Route path="/sites/:siteId/inspections/:inspectionId/capture" element={<InspectionCapture />} />

            {/* Inspections */}
            <Route path="/inspections" element={<InspectionList />} />

            {/* Defects */}
            <Route path="/defects" element={<DefectTracker />} />

            {/* Incidents */}
            <Route path="/incidents" element={<IncidentList />} />
            <Route path="/incidents/new" element={<IncidentForm />} />
            <Route path="/incidents/:id" element={<IncidentForm />} />

            {/* Sealed Exports */}
            <Route path="/sealed-exports" element={<SealedExportsPage />} />

            {/* Normalisation */}
            <Route path="/normalisation-history" element={<NormalisationHistoryPage />} />

            {/* Settings */}
            <Route path="/settings" element={<SettingsPage />} />

            {/* Route Planner */}
            <Route path="/route-planner" element={<RoutePlanner />} />
            <Route path="/portal/*" element={<PortalRouter />} />

            {/* ── Feature 14: Inspector Performance ── */}
            <Route path="/inspector-performance" element={<InspectorPerformancePage />} />
            <Route path="/inspector-performance/:userId" element={<InspectorDetailPage />} />
            <Route path="/my-performance" element={<MyPerformancePage />} />

            {/* ── Feature 15: Defect Library ── */}
            <Route path="/defect-library" element={<DefectLibraryPage />} />

            {/* ── Feature 17: Manufacturer Recalls ── */}
            <Route path="/recalls" element={<RecallsPage />} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
}
