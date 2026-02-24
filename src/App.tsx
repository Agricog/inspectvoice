/**
 * InspectVoice — App Root
 * Route definitions with Layout shell and PWA update prompt.
 *
 * Note: BrowserRouter and HelmetProvider live here (not in main.tsx)
 * to avoid duplication.
 *
 * Build Standard: Autaimate v3
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
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
          <Route element={<Layout />}>
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
