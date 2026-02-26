/**
 * InspectVoice — Portal Inspection Detail Page
 * src/portal/pages/InspectionDetailPage.tsx
 */

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchInspection, type PortalInspection } from '../api/portalApi';
import { LoadingSkeleton, ErrorCard, RiskBadge, SeverityBadge, StatusBadge, fmtDate, fmtType } from './DashboardPage';

export function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PortalInspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchInspection(id)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorCard message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Link to="/portal/inspections" className="text-sm text-blue-600 hover:text-blue-800">
        ← Back to inspections
      </Link>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{data.site_name}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {fmtType(data.inspection_type)} · {fmtDate(data.signed_at)}
            </p>
          </div>
          {data.overall_risk_rating && <RiskBadge rating={data.overall_risk_rating} />}
        </div>

        {/* Defect severity breakdown */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-gray-100">
          <MiniStat label="Very High" value={data.very_high_count} color="text-red-600" />
          <MiniStat label="High" value={data.high_count} color="text-orange-600" />
          <MiniStat label="Medium" value={data.medium_count} color="text-amber-600" />
          <MiniStat label="Low" value={data.low_count} color="text-green-600" />
        </div>

        {data.closure_recommended && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm font-medium text-red-700">Closure Recommended</p>
            {data.closure_reason && <p className="text-sm text-red-600 mt-1">{data.closure_reason}</p>}
          </div>
        )}

        {data.immediate_action_required && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm font-medium text-amber-700">Immediate Action Required</p>
          </div>
        )}

        {data.pdf_url && (
          <div className="mt-4">
            <span className="inline-flex items-center gap-1.5 text-sm text-blue-600 font-medium">
              📄 PDF report available
            </span>
          </div>
        )}
      </div>

      {/* Inspection items */}
      {data.items.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Inspection Items ({data.items.length})</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {data.items.map((item) => (
              <div key={item.id} className="px-5 py-3.5">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-sm font-medium text-gray-900">{item.asset_code}</span>
                  <span className="text-xs text-gray-500">{fmtType(item.asset_type)}</span>
                  {item.risk_rating && <RiskBadge rating={item.risk_rating} />}
                </div>
                {item.inspector_notes && (
                  <p className="text-sm text-gray-600 mt-1">{item.inspector_notes}</p>
                )}
                {item.requires_action && item.action_timeframe && (
                  <p className="text-xs text-amber-600 mt-1">
                    Action required: {item.action_timeframe.replace(/_/g, ' ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Defects found */}
      {data.defects.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Defects Found ({data.defects.length})</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {data.defects.map((d) => (
              <Link
                key={d.id}
                to={`/portal/defects/${d.id}`}
                className="flex items-start gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900">{d.description}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <SeverityBadge severity={d.severity} />
                    <StatusBadge status={d.status} />
                    {d.asset_code && <span className="text-xs text-gray-400">{d.asset_code}</span>}
                    {d.due_date && <span className="text-xs text-gray-400">Due: {fmtDate(d.due_date)}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <p className={`text-xl font-bold ${value > 0 ? color : 'text-gray-300'}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
