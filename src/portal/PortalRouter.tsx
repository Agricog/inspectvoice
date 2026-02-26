/**
 * InspectVoice — Portal Router
 * src/portal/PortalRouter.tsx
 *
 * Drop this into your main App router:
 *
 *   import { PortalRouter } from './portal/PortalRouter';
 *   <Route path="/portal/*" element={<PortalRouter />} />
 *
 * Everything under /portal uses the portal Clerk instance + layout.
 */

import { Routes, Route } from 'react-router-dom';
import { PortalAuthProvider } from './auth/PortalAuthProvider';
import { PortalLayout } from './layout/PortalLayout';

// Pages (will be built in next batches — stubs for now)
import { DashboardPage } from './pages/DashboardPage';
import { SitesPage } from './pages/SitesPage';
import { SiteDetailPage } from './pages/SiteDetailPage';
import { InspectionsPage } from './pages/InspectionsPage';
import { InspectionDetailPage } from './pages/InspectionDetailPage';
import { DefectsPage } from './pages/DefectsPage';
import { DefectDetailPage } from './pages/DefectDetailPage';
import { NotificationsPage } from './pages/NotificationsPage';

export function PortalRouter() {
  return (
    <PortalAuthProvider>
      <PortalLayout>
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="sites" element={<SitesPage />} />
          <Route path="sites/:id" element={<SiteDetailPage />} />
          <Route path="inspections" element={<InspectionsPage />} />
          <Route path="inspections/:id" element={<InspectionDetailPage />} />
          <Route path="defects" element={<DefectsPage />} />
          <Route path="defects/:id" element={<DefectDetailPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Routes>
      </PortalLayout>
    </PortalAuthProvider>
  );
}
