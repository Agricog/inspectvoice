/**
 * InspectVoice — Recall Alert Components (Feature 17)
 * src/components/RecallAlertBanner.tsx
 *
 * Two components:
 * 1. RecallAlertBanner — dashboard-level banner showing all active recalls with unacknowledged matches
 * 2. RecallAssetWarning — asset-detail-level warning showing recalls affecting a specific asset
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { Link } from 'react-router-dom';
import {
  AlertOctagon,
  ChevronRight,
  ExternalLink,
  ShieldAlert,
  Bell,
} from 'lucide-react';
import { useFetch } from '@hooks/useFetch';
import type {
  RecallAlert,
  AssetRecallMatch,
  RecallSeverity,
} from '@/types/recalls';
import {
  RECALL_SEVERITY_LABELS,
  RECALL_SEVERITY_STYLES,
  RECALL_MATCH_STATUS_LABELS,
  RECALL_MATCH_STATUS_STYLES,
} from '@/types/recalls';

// =============================================
// HELPERS
// =============================================

function severityIcon(severity: RecallSeverity): JSX.Element {
  const style = RECALL_SEVERITY_STYLES[severity];
  if (severity === 'critical') {
    return <AlertOctagon className={`w-4 h-4 ${style.text}`} />;
  }
  return <ShieldAlert className={`w-4 h-4 ${style.text}`} />;
}

// =============================================
// DASHBOARD BANNER — active recalls with matches
// =============================================

interface RecallAlertsResponse {
  success: boolean;
  data: RecallAlert[];
}

export function RecallAlertBanner(): JSX.Element | null {
  const { data, loading } = useFetch<RecallAlertsResponse>('/api/v1/recalls/alerts');

  const alerts = data?.data ?? [];

  // Only show if there are active recalls with matches
  if (loading || alerts.length === 0) return null;

  const totalUnacknowledged = alerts.reduce((sum, a) => sum + a.unacknowledged_count, 0);
  const hasCritical = alerts.some((a) => a.severity === 'critical');

  return (
    <div
      className={`rounded-xl border p-4 ${
        hasCritical
          ? 'bg-red-500/10 border-red-500/30'
          : 'bg-orange-500/10 border-orange-500/30'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bell className={`w-4 h-4 ${hasCritical ? 'text-red-400' : 'text-orange-400'}`} />
          <h2 className="text-sm font-semibold text-iv-text">
            Manufacturer Recalls
          </h2>
          {totalUnacknowledged > 0 && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-2xs font-bold bg-red-500/15 text-red-400">
              {totalUnacknowledged} unacknowledged
            </span>
          )}
        </div>
        <Link
          to="/recalls"
          className="text-2xs text-iv-muted hover:text-iv-accent transition-colors inline-flex items-center gap-1"
        >
          Manage recalls
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      <ul className="space-y-2">
        {alerts.map((alert) => {
          const style = RECALL_SEVERITY_STYLES[alert.severity];

          return (
            <li
              key={alert.id}
              className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-iv-surface/60"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {severityIcon(alert.severity)}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold ${style.bg} ${style.text}`}>
                      {RECALL_SEVERITY_LABELS[alert.severity]}
                    </span>
                    <span className="text-sm text-iv-text line-clamp-1">{alert.title}</span>
                  </div>
                  <p className="text-2xs text-iv-muted mt-0.5">
                    {alert.manufacturer} · {alert.matched_asset_count} asset{alert.matched_asset_count !== 1 ? 's' : ''} affected
                    {alert.unacknowledged_count > 0 && (
                      <span className="text-red-400 ml-1">
                        · {alert.unacknowledged_count} pending review
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <Link
                to={`/recalls?id=${alert.id}`}
                className="iv-btn-icon shrink-0"
                title="View recall details"
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// =============================================
// ASSET DETAIL WARNING — recalls affecting this asset
// =============================================

interface AssetRecallsResponse {
  success: boolean;
  data: AssetRecallMatch[];
}

interface RecallAssetWarningProps {
  assetId: string;
}

export function RecallAssetWarning({ assetId }: RecallAssetWarningProps): JSX.Element | null {
  const { data, loading } = useFetch<AssetRecallsResponse>(
    assetId ? `/api/v1/assets/${assetId}/recalls` : '',
  );

  const recalls = data?.data ?? [];

  if (loading || recalls.length === 0) return null;

  return (
    <div className="iv-panel p-4 mb-4 border-l-4 border-l-red-500">
      <div className="flex items-center gap-2 mb-3">
        <AlertOctagon className="w-4 h-4 text-red-400" />
        <h2 className="text-sm font-semibold text-iv-text">Active Recall Notice</h2>
        <span className="text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-medium">
          {recalls.length}
        </span>
      </div>

      <div className="space-y-3">
        {recalls.map((recall) => {
          const sevStyle = RECALL_SEVERITY_STYLES[recall.severity];
          const matchStatusStyle = RECALL_MATCH_STATUS_STYLES[recall.match_status];

          return (
            <div
              key={recall.match_id}
              className="p-3 rounded-lg bg-red-500/5"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold ${sevStyle.bg} ${sevStyle.text}`}>
                      {RECALL_SEVERITY_LABELS[recall.severity]}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ${matchStatusStyle.bg} ${matchStatusStyle.text}`}>
                      {RECALL_MATCH_STATUS_LABELS[recall.match_status]}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-iv-text">{recall.title}</p>
                  <p className="text-xs text-iv-muted mt-1">{recall.manufacturer}</p>
                </div>

                <Link
                  to={`/recalls?id=${recall.recall_id}`}
                  className="iv-btn-icon shrink-0"
                  title="View full recall"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>

              <p className="text-xs text-iv-muted line-clamp-2 mb-2">{recall.description}</p>

              {/* Match reason — defensible provenance */}
              <div className="bg-iv-surface/60 rounded p-2 mb-2">
                <p className="text-2xs text-iv-muted">
                  <span className="font-medium">Match reason:</span> {recall.match_reason}
                </p>
              </div>

              {/* Action taken */}
              {recall.action_taken && (
                <p className="text-2xs text-emerald-400">
                  Action: {recall.action_taken}
                </p>
              )}

              {/* Source link */}
              {recall.source_url && (
                <a
                  href={recall.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-2xs text-iv-accent hover:underline inline-flex items-center gap-1 mt-1"
                >
                  View source
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
