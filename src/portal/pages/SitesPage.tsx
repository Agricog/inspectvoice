/**
 * InspectVoice — Portal Sites Page
 * src/portal/pages/SitesPage.tsx
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchSites, type PortalSite } from '../api/portalApi';
import { LoadingSkeleton, ErrorCard, Chevron, fmtDate } from './DashboardPage';

export function SitesPage() {
  const [sites, setSites] = useState<PortalSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSites()
      .then(setSites)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">{sites.length} site{sites.length !== 1 ? 's' : ''} available</p>

      {sites.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          No sites granted yet. Your inspection provider will grant site access.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <Link
              key={site.id}
              to={`/portal/sites/${site.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow flex flex-col"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 truncate">{site.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{site.site_code}</p>
                </div>
                <Chevron />
              </div>

              <p className="text-xs text-gray-500 truncate mb-3">{site.address}, {site.postcode}</p>

              <div className="mt-auto flex items-center gap-4 text-xs text-gray-500">
                <span>{site.asset_count} asset{site.asset_count !== 1 ? 's' : ''}</span>
                <span className={site.open_defects > 0 ? 'text-amber-600 font-medium' : ''}>
                  {site.open_defects} open defect{site.open_defects !== 1 ? 's' : ''}
                </span>
              </div>

              {site.last_inspection_date && (
                <p className="text-[11px] text-gray-400 mt-2">
                  Last inspected: {fmtDate(site.last_inspection_date)}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
