/**
 * InspectVoice — Portal Site Detail Page
 * src/portal/pages/SiteDetailPage.tsx
 */

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchSite, type PortalSiteDetail } from '../api/portalApi';
import { LoadingSkeleton, ErrorCard, RiskBadge, Chevron, fmtDate, fmtType } from './DashboardPage';

export function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [site, setSite] = useState<PortalSiteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchSite(id)
      .then(setSite)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorCard message={error} />;
  if (!site) return null;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/portal/sites" className="text-sm text-blue-600 hover:text-blue-800">
        ← Back to sites
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-bold text-gray-900">{site.name}</h2>
        <p className="text-sm text-gray-500 mt-1">{site.site_code} · {site.site_type?.replace(/_/g, ' ')}</p>
        <p className="text-sm text-gray-500 mt-1">{site.address}, {site.postcode}</p>

        {(site.contact_name || site.contact_phone || site.contact_email) && (
          <div className="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-600">
            {site.contact_name && <p>Contact: {site.contact_name}</p>}
            {site.contact_phone && <p>Phone: {site.contact_phone}</p>}
            {site.contact_email && <p>Email: {site.contact_email}</p>}
          </div>
        )}

        {site.access_notes && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Access Notes</p>
            <p className="text-sm text-gray-600">{site.access_notes}</p>
          </div>
        )}
      </div>

      {/* Assets */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Assets ({site.assets.length})</h3>
        </div>

        {site.assets.length === 0 ? (
          <div className="px-5 py-6 text-center text-gray-400 text-sm">No assets recorded</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-5 py-2.5 font-medium text-gray-500 text-xs uppercase">Code</th>
                  <th className="px-5 py-2.5 font-medium text-gray-500 text-xs uppercase">Type</th>
                  <th className="px-5 py-2.5 font-medium text-gray-500 text-xs uppercase hidden sm:table-cell">Manufacturer</th>
                  <th className="px-5 py-2.5 font-medium text-gray-500 text-xs uppercase hidden md:table-cell">Last Inspected</th>
                  <th className="px-5 py-2.5 font-medium text-gray-500 text-xs uppercase">Condition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {site.assets.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{a.asset_code}</td>
                    <td className="px-5 py-3 text-gray-600">{fmtType(a.asset_type)}</td>
                    <td className="px-5 py-3 text-gray-600 hidden sm:table-cell">{a.manufacturer_name ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600 hidden md:table-cell">
                      {a.last_inspection_date ? fmtDate(a.last_inspection_date) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {a.last_inspection_condition ? (
                        <ConditionBadge condition={a.last_inspection_condition} />
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent inspections */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Recent Inspections</h3>
        </div>

        {site.recent_inspections.length === 0 ? (
          <div className="px-5 py-6 text-center text-gray-400 text-sm">No inspections yet</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {site.recent_inspections.map((ins) => (
              <Link
                key={ins.id}
                to={`/portal/inspections/${ins.id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{fmtType(ins.inspection_type)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{fmtDate(ins.signed_at)}</p>
                </div>
                {ins.overall_risk_rating && <RiskBadge rating={ins.overall_risk_rating} />}
                <span className="text-xs text-gray-400">{ins.total_defects} defect{ins.total_defects !== 1 ? 's' : ''}</span>
                <Chevron />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConditionBadge({ condition }: { condition: string }) {
  const c: Record<string, string> = {
    good: 'bg-green-100 text-green-700',
    fair: 'bg-amber-100 text-amber-700',
    poor: 'bg-orange-100 text-orange-700',
    very_poor: 'bg-red-100 text-red-700',
    out_of_service: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c[condition] ?? 'bg-gray-100 text-gray-600'}`}>
      {condition.replace(/_/g, ' ')}
    </span>
  );
}
