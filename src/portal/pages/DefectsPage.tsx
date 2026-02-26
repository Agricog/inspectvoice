/**
 * InspectVoice - Portal Defects Page
 * src/portal/pages/DefectsPage.tsx
 */

import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchDefects, type PortalDefect } from '../api/portalApi';
import { LoadingSkeleton, ErrorCard, SeverityBadge, StatusBadge, Chevron, fmtDate } from './DashboardPage';

export function DefectsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<PortalDefect[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const severity = searchParams.get('severity') ?? '';
  const status = searchParams.get('status') ?? '';

  useEffect(() => {
    setLoading(true);
    fetchDefects({
      limit,
      offset,
      severity: severity || undefined,
      status: status || undefined,
    })
      .then((res) => {
        setRows(res.data);
        setTotal(res.pagination.total);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => setLoading(false));
  }, [offset, severity, status]);

  function setFilter(key: string, val: string) {
    const params = new URLSearchParams(searchParams);
    if (val) {
      params.set(key, val);
    } else {
      params.delete(key);
    }
    setSearchParams(params);
    setOffset(0);
  }

  if (loading && offset === 0) return <LoadingSkeleton />;
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <FilterSelect
          label="Severity"
          value={severity}
          onChange={(v) => setFilter('severity', v)}
          options={[
            { value: '', label: 'All severities' },
            { value: 'very_high', label: 'Very High' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => setFilter('status', v)}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'open', label: 'Open' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'verified', label: 'Verified' },
          ]}
        />
        <span className="self-center text-sm text-gray-500">
          {total} defect{total !== 1 ? 's' : ''}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          {severity || status ? 'No defects match the current filters.' : 'No defects found.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-100">
            {rows.map((d) => (
              <Link
                key={d.id}
                to={`/portal/defects/${d.id}`}
                className="flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 line-clamp-2">{d.description}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <SeverityBadge severity={d.severity} />
                    <StatusBadge status={d.status} />
                    {d.site_name && (
                      <span className="text-xs text-gray-400">{d.site_name}</span>
                    )}
                    {d.asset_code && (
                      <span className="text-xs text-gray-400">{d.asset_code}</span>
                    )}
                  </div>
                  {d.due_date && (
                    <p className="text-xs text-gray-400 mt-1">Due: {fmtDate(d.due_date)}</p>
                  )}
                  {d.client_latest_status && (
                    <p className="text-xs text-blue-500 mt-1">
                      Client status: {d.client_latest_status.replace(/_/g, ' ')}
                      {d.client_latest_verified === true && ' (verified)'}
                      {d.client_latest_verified === false && ' (pending verification)'}
                    </p>
                  )}
                </div>
                <Chevron />
              </Link>
            ))}
          </div>

          {total > limit && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
              <span className="text-gray-500">
                {offset + 1}-{Math.min(offset + limit, total)} of {total}
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
