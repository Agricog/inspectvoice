/**
 * InspectVoice — App Root
 * Route definitions with Layout shell.
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Layout } from '@components/Layout';
import { SiteList } from '@pages/SiteList';
import { SiteForm } from '@pages/SiteForm';
import { SiteDetail } from '@pages/SiteDetail';

// =============================================
// PLACEHOLDER PAGES (will be replaced)
// =============================================

function Dashboard(): JSX.Element {
  return (
    <div className="text-center py-16">
      <h1 className="text-xl font-semibold text-iv-text mb-2">InspectVoice Dashboard</h1>
      <p className="text-sm text-iv-muted">Coming soon — risk overview, compliance calendar, recent activity.</p>
    </div>
  );
}

function InspectionsList(): JSX.Element {
  return (
    <div className="text-center py-16">
      <h1 className="text-xl font-semibold text-iv-text mb-2">Inspections</h1>
      <p className="text-sm text-iv-muted">Coming soon — inspection list, drafts, completed reports.</p>
    </div>
  );
}

function DefectsList(): JSX.Element {
  return (
    <div className="text-center py-16">
      <h1 className="text-xl font-semibold text-iv-text mb-2">Defect Tracker</h1>
      <p className="text-sm text-iv-muted">Coming soon — open defects, assigned actions, resolution tracking.</p>
    </div>
  );
}

function SettingsPage(): JSX.Element {
  return (
    <div className="text-center py-16">
      <h1 className="text-xl font-semibold text-iv-text mb-2">Settings</h1>
      <p className="text-sm text-iv-muted">Coming soon — profile, credentials, organisation, subscription.</p>
    </div>
  );
}

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
        <Routes>
          <Route element={<Layout />}>
            {/* Dashboard */}
            <Route path="/" element={<Dashboard />} />

            {/* Sites */}
            <Route path="/sites" element={<SiteList />} />
            <Route path="/sites/new" element={<SiteForm />} />
            <Route path="/sites/:id" element={<SiteDetail />} />
            <Route path="/sites/:id/edit" element={<SiteForm />} />

            {/* Inspections (placeholder) */}
            <Route path="/inspections" element={<InspectionsList />} />

            {/* Defects (placeholder) */}
            <Route path="/defects" element={<DefectsList />} />

            {/* Settings (placeholder) */}
            <Route path="/settings" element={<SettingsPage />} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
}
