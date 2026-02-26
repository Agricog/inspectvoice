/**
 * InspectVoice — App Root
 * Route definitions with Layout shell, Clerk auth gates, and PWA update prompt.
 *
 * UPDATED: Features 14 (Inspector Performance) + 15 (Defect Library) routes added.
 * UPDATED: Landing page at / for SEO, dashboard moved to /dashboard.
 *
 * Build Standard: Autaimate v3
 */

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
} from '@clerk/clerk-react';
import { Layout } from '@components/Layout';
import { PWAUpdatePrompt } from '@components/PWAUpdatePrompt';
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

          {/* Landing page — SEO entry point for search engines & unauthenticated visitors */}
          <Route
            path="/"
            element={
              <>
                <SignedIn>
                  <Navigate to="/dashboard" replace />
                </SignedIn>
                <SignedOut>
                  <LandingPage />
                </SignedOut>
              </>
            }
          />

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
