/**
 * InspectVoice — App Root
 * Route definitions with Layout shell, Clerk auth gates, and PWA update prompt.
 *
 * Auth flow:
 *   - Unauthenticated users → redirected to /sign-in
 *   - Authenticated users without org → Clerk org selector shown
 *   - Authenticated users with active org → dashboard
 *
 * Note: ClerkProvider lives in main.tsx. BrowserRouter and HelmetProvider live here.
 *
 * Build Standard: Autaimate v3
 */

import { BrowserRouter, Routes, Route, } from 'react-router-dom';
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

// =============================================
// ORG GATE — requires active organisation
// =============================================

/**
 * If signed in but no active organisation, show the org selector.
 * Your Worker guard requires org_id in the JWT — without it, all
 * API calls return 401.
 */
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
          afterSelectOrganizationUrl="/"
          afterCreateOrganizationUrl="/"
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

          {/* ── Protected routes ── */}
          <Route
            element={
              <AuthGate>
                <Layout />
              </AuthGate>
            }
          >
            {/* Dashboard */}
            <Route path="/" element={<ManagerDashboard />} />

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

            {/* Settings */}
            <Route path="/settings" element={<SettingsPage />} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
}
