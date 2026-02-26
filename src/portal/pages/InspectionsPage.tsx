/**
 * InspectVoice — Portal Inspections Page
 * src/portal/pages/InspectionsPage.tsx
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchInspections, type PortalInspectionSummary } from '../api/portalApi';
import { LoadingSkeleton, ErrorCard, RiskBadge, Chevron, fmtDate, fmtType } from './DashboardPage';

type Row = PortalInspectionSummary & { site_name: string; signed_by: string };

export function InspectionsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    fetchInspections({ limit, offset })
      .then((res) => {
        setRows(res.data as Row[]);
        setTotal(res.pagination.total);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [offset]);

  if (loading && offset === 0) return <LoadingSkeleton />;
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">{total} report{total !== 1 ? 's' : ''}</p>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          No inspection reports available yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-5 py-2.5 font-medium text-gray-500 text-xs uppercase">Site</th>
                  <th className="px-5 py-2.5 font-medium text-gray-500 text-xs uppercase hidden sm:table-cell">Type</th>
                  <th className="px-5 py-2.5 font-medium text-gray-500 text-xs uppercase">Date</th>
                  <th className="px-5 py-2.5 font-medium text-gray-500 text-xs uppercase">Risk</th>
                  <th className="px-5 py-2.5 font-medium text-gray-500 text-xs uppercase hidden md:table-cell">Defects</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <Link to={`/portal/inspections/${r.id}`} className="font-medium text-blue-600 hover:text-blue-800">
                        {r.site_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-600 hidden sm:table-cell">{fmtType(r.inspection_type)}</td>
                    <td className="px-5 py-3 text-gray-600">{fmtDate(r.signed_at)}</td>
                    <td className="px-5 py-3">
                      {r.overall_risk_rating ? <RiskBadge rating={r.overall_risk_rating} /> : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600 hidden md:table-cell">{r.total_defects}</td>
                    <td className="px-5 py-3">
                      <Link to={`/portal/inspections/${r.id}`}><Chevron /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
              <span className="text-gray-500">
                Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= total}
                  className="px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
