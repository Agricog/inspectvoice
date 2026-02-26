/**
 * InspectVoice — Recalls Management Page (Feature 17)
 * src/pages/RecallsPage.tsx
 *
 * Route: /recalls
 *
 * Manager/admin UI for:
 * - Listing all manufacturer recalls (filterable by status)
 * - Creating new recalls (auto-runs matching engine)
 * - Viewing recall detail with matched assets
 * - Acknowledging/actioning matched assets
 * - Resolving/dismissing recalls
 * - Re-running matching after asset register changes
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Bell,
  Plus,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  CheckCircle,
  XCircle,
  Factory,
  Link2,
  Eye,
} from 'lucide-react';
import { useFetch } from '@hooks/useFetch';
import { getAuthToken } from '@utils/authToken';
import type {
  ManufacturerRecall,
  RecallWithMatches,
  RecallAssetMatch,
  RecallSeverity,
  RecallMatchStatus,
} from '@/types/recalls';
import {
  RECALL_SEVERITY_LABELS,
  RECALL_SEVERITY_STYLES,
  RECALL_STATUS_LABELS,
  RECALL_MATCH_STATUS_LABELS,
  RECALL_MATCH_STATUS_STYLES,
  RECALL_MATCH_CONFIDENCE_LABELS,
} from '@/types/recalls';

// =============================================
// HELPERS
// =============================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? 'Request failed');
  }
  return res.json() as Promise<T>;
}

// =============================================
// RECALL FORM (Create / Edit)
// =============================================

interface RecallFormData {
  title: string;
  manufacturer: string;
  affected_models: string;
  severity: RecallSeverity;
  description: string;
  source_url: string;
  source_reference: string;
  published_date: string;
}

const EMPTY_FORM: RecallFormData = {
  title: '',
  manufacturer: '',
  affected_models: '',
  severity: 'medium',
  description: '',
  source_url: '',
  source_reference: '',
  published_date: '',
};

function RecallForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  initial?: RecallFormData;
  onSubmit: (data: RecallFormData) => void;
  onCancel: () => void;
  submitting: boolean;
}): JSX.Element {
  const [form, setForm] = useState<RecallFormData>(initial ?? EMPTY_FORM);

  const handleChange = (field: keyof RecallFormData, value: string): void => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Title */}
      <div>
        <label className="iv-label" htmlFor="recall-title">Recall Title *</label>
        <input
          id="recall-title"
          type="text"
          className="iv-input w-full"
          value={form.title}
          onChange={(e) => handleChange('title', e.target.value)}
          placeholder="e.g. Wicksteed MultiPlay 200 series — bearing failure risk"
          required
        />
      </div>

      {/* Manufacturer + Severity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="iv-label" htmlFor="recall-mfr">Manufacturer *</label>
          <input
            id="recall-mfr"
            type="text"
            className="iv-input w-full"
            value={form.manufacturer}
            onChange={(e) => handleChange('manufacturer', e.target.value)}
            placeholder="e.g. Wicksteed"
            required
          />
        </div>
        <div>
          <label className="iv-label" htmlFor="recall-severity">Severity *</label>
          <select
            id="recall-severity"
            className="iv-select w-full"
            value={form.severity}
            onChange={(e) => handleChange('severity', e.target.value as RecallSeverity)}
          >
            <option value="critical">Critical — Immediate withdrawal</option>
            <option value="high">High — Restrict use within 48h</option>
            <option value="medium">Medium — Inspect within 1 month</option>
            <option value="advisory">Advisory — Monitor at next inspection</option>
          </select>
        </div>
      </div>

      {/* Affected Models */}
      <div>
        <label className="iv-label" htmlFor="recall-models">
          Affected Models
          <span className="text-iv-muted font-normal ml-1">(one per line, use * for wildcards)</span>
        </label>
        <textarea
          id="recall-models"
          className="iv-input w-full"
          rows={3}
          value={form.affected_models}
          onChange={(e) => handleChange('affected_models', e.target.value)}
          placeholder={`MultiPlay 200\nMultiPlay 300*\n*Series X`}
        />
        <p className="text-2xs text-iv-muted mt-1">
          Leave empty to match all assets from this manufacturer.
        </p>
      </div>

      {/* Description */}
      <div>
        <label className="iv-label" htmlFor="recall-desc">Description *</label>
        <textarea
          id="recall-desc"
          className="iv-input w-full"
          rows={4}
          value={form.description}
          onChange={(e) => handleChange('description', e.target.value)}
          placeholder="Describe the recall notice, the safety concern, and recommended actions."
          required
        />
      </div>

      {/* Source + Reference + Date */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="iv-label" htmlFor="recall-source">Source URL</label>
          <input
            id="recall-source"
            type="url"
            className="iv-input w-full"
            value={form.source_url}
            onChange={(e) => handleChange('source_url', e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div>
          <label className="iv-label" htmlFor="recall-ref">Reference</label>
          <input
            id="recall-ref"
            type="text"
            className="iv-input w-full"
            value={form.source_reference}
            onChange={(e) => handleChange('source_reference', e.target.value)}
            placeholder="e.g. OPSS/2026/001"
          />
        </div>
        <div>
          <label className="iv-label" htmlFor="recall-date">Published Date</label>
          <input
            id="recall-date"
            type="date"
            className="iv-input w-full"
            value={form.published_date}
            onChange={(e) => handleChange('published_date', e.target.value)}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="iv-btn-secondary"
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="iv-btn-primary"
          disabled={submitting || !form.title.trim() || !form.manufacturer.trim() || !form.description.trim()}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating…
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              Create Recall
            </>
          )}
        </button>
      </div>
    </form>
  );
}

// =============================================
// MATCH ACTION MODAL
// =============================================

function MatchActionRow({
  match,
  onAction,
}: {
  match: RecallAssetMatch;
  onAction: (matchId: string, status: RecallMatchStatus, actionTaken?: string, notes?: string) => void;
}): JSX.Element {
  const [showActions, setShowActions] = useState(false);
  const [actionTaken, setActionTaken] = useState(match.action_taken ?? '');
  const [notes, setNotes] = useState(match.notes ?? '');
  const matchStatusStyle = RECALL_MATCH_STATUS_STYLES[match.status];

  return (
    <div className="p-3 rounded-lg bg-iv-surface-2/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-iv-text">{match.asset_code}</span>
            <span className="text-2xs text-iv-muted">{match.asset_type}</span>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ${matchStatusStyle.bg} ${matchStatusStyle.text}`}>
              {RECALL_MATCH_STATUS_LABELS[match.status]}
            </span>
          </div>
          <p className="text-2xs text-iv-muted">
            {match.site_name} · {match.asset_manufacturer} {match.asset_model ?? ''}
          </p>
          <p className="text-2xs text-iv-muted mt-1">
            <span className="font-medium">Match:</span> {match.match_reason}
          </p>
          <p className="text-2xs text-iv-muted">
            Confidence: {RECALL_MATCH_CONFIDENCE_LABELS[match.match_confidence]}
          </p>
          {match.action_taken && (
            <p className="text-2xs text-emerald-400 mt-1">Action: {match.action_taken}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {match.asset_id && match.site_id && (
            <Link
              to={`/sites/${match.site_id}/assets/${match.asset_id}`}
              className="iv-btn-icon"
              title="View asset"
            >
              <Eye className="w-3.5 h-3.5" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setShowActions(!showActions)}
            className="iv-btn-icon"
            title="Update status"
          >
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showActions ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {showActions && (
        <div className="mt-3 pt-3 border-t border-iv-border space-y-3">
          {/* Status buttons */}
          <div className="flex flex-wrap gap-2">
            {(['acknowledged', 'inspected', 'withdrawn', 'replaced', 'not_affected'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onAction(match.id, s, actionTaken || undefined, notes || undefined)}
                className={`text-2xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                  match.status === s
                    ? 'bg-iv-accent/15 text-iv-accent border-iv-accent/30'
                    : 'bg-iv-surface border-iv-border text-iv-muted hover:text-iv-text hover:border-iv-accent/30'
                }`}
              >
                {RECALL_MATCH_STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Action taken + notes */}
          <div>
            <label className="iv-label text-2xs">Action taken</label>
            <input
              type="text"
              className="iv-input w-full text-sm"
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              placeholder="e.g. Equipment inspected — no defect found"
            />
          </div>
          <div>
            <label className="iv-label text-2xs">Notes</label>
            <textarea
              className="iv-input w-full text-sm"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
            />
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================
// RECALL DETAIL VIEW
// =============================================

function RecallDetail({
  recallId,
  onBack,
}: {
  recallId: string;
  onBack: () => void;
}): JSX.Element {
  const { data, loading, error, refetch } = useFetch<{ success: boolean; data: RecallWithMatches }>(
    `/api/v1/recalls/${recallId}`,
  );
  const [rematching, setRematching] = useState(false);
  const [resolving, setResolving] = useState(false);

  const recall = data?.data ?? null;
  const matches = recall?.matches ?? [];
  const unacknowledged = matches.filter((m) => m.status === 'unacknowledged');

  const handleMatchAction = useCallback(
    async (matchId: string, status: RecallMatchStatus, actionTaken?: string, notes?: string) => {
      try {
        await apiFetch(`/api/v1/recalls/matches/${matchId}`, {
          method: 'PUT',
          body: JSON.stringify({ status, action_taken: actionTaken, notes }),
        });
        refetch();
      } catch (err) {
        console.error('Failed to update match:', err);
      }
    },
    [refetch],
  );

  const handleRematch = useCallback(async () => {
    setRematching(true);
    try {
      await apiFetch(`/api/v1/recalls/${recallId}/rematch`, { method: 'POST' });
      refetch();
    } catch (err) {
      console.error('Rematch failed:', err);
    } finally {
      setRematching(false);
    }
  }, [recallId, refetch]);

  const handleResolve = useCallback(async (status: 'resolved' | 'dismissed') => {
    setResolving(true);
    try {
      await apiFetch(`/api/v1/recalls/${recallId}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      refetch();
    } catch (err) {
      console.error('Resolve failed:', err);
    } finally {
      setResolving(false);
    }
  }, [recallId, refetch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-iv-muted" />
      </div>
    );
  }

  if (error || !recall) {
    return (
      <div className="text-center py-8">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-iv-muted">Failed to load recall</p>
        <button type="button" onClick={onBack} className="iv-btn-secondary mt-3">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>
    );
  }

  const sevStyle = RECALL_SEVERITY_STYLES[recall.severity];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} className="iv-btn-icon mt-0.5">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold ${sevStyle.bg} ${sevStyle.text}`}>
                {RECALL_SEVERITY_LABELS[recall.severity]}
              </span>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ${
                recall.status === 'active' ? 'bg-red-500/15 text-red-400' : 'bg-iv-muted/15 text-iv-muted'
              }`}>
                {RECALL_STATUS_LABELS[recall.status]}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-iv-text">{recall.title}</h2>
            <p className="text-xs text-iv-muted mt-0.5">
              {recall.manufacturer}
              {recall.source_reference && ` · ${recall.source_reference}`}
              {recall.published_date && ` · Published ${formatDate(recall.published_date)}`}
            </p>
          </div>
        </div>

        {/* Actions */}
        {recall.status === 'active' && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRematch}
              disabled={rematching}
              className="iv-btn-secondary text-xs"
              title="Re-run matching against current asset register"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${rematching ? 'animate-spin' : ''}`} />
              Rematch
            </button>
            <button
              type="button"
              onClick={() => handleResolve('resolved')}
              disabled={resolving}
              className="iv-btn-secondary text-xs"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Resolve
            </button>
            <button
              type="button"
              onClick={() => handleResolve('dismissed')}
              disabled={resolving}
              className="iv-btn-secondary text-xs"
            >
              <XCircle className="w-3.5 h-3.5" />
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="iv-panel p-4">
        <p className="text-sm text-iv-text whitespace-pre-wrap">{recall.description}</p>
        {recall.affected_models.length > 0 && (
          <div className="mt-3 pt-3 border-t border-iv-border">
            <p className="text-xs text-iv-muted font-medium mb-1">Affected models:</p>
            <div className="flex flex-wrap gap-1.5">
              {recall.affected_models.map((m, i) => (
                <span key={i} className="text-xs font-mono bg-iv-surface-2 px-2 py-0.5 rounded text-iv-text">
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}
        {recall.source_url && (
          <a
            href={recall.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-iv-accent hover:underline inline-flex items-center gap-1 mt-3"
          >
            <Link2 className="w-3 h-3" />
            View original notice
          </a>
        )}
      </div>

      {/* Matched Assets */}
      <div className="iv-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Factory className="w-4 h-4 text-iv-accent" />
            <h3 className="text-sm font-semibold text-iv-text">
              Matched Assets
            </h3>
            <span className="text-xs text-iv-muted">
              {matches.length} total
            </span>
            {unacknowledged.length > 0 && (
              <span className="text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-medium">
                {unacknowledged.length} pending
              </span>
            )}
          </div>
        </div>

        {matches.length === 0 ? (
          <div className="text-center py-6">
            <CheckCircle className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-emerald-400 font-medium">No matching assets found</p>
            <p className="text-xs text-iv-muted mt-1">
              This recall does not affect any assets in your register.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {matches.map((match) => (
              <MatchActionRow key={match.id} match={match} onAction={handleMatchAction} />
            ))}
          </div>
        )}
      </div>

      {/* Resolution details */}
      {recall.status !== 'active' && recall.resolved_at && (
        <div className="iv-panel p-4">
          <h3 className="text-sm font-semibold text-iv-text mb-2">Resolution</h3>
          <p className="text-xs text-iv-muted">
            {recall.status === 'resolved' ? 'Resolved' : 'Dismissed'} on {formatDate(recall.resolved_at)}
          </p>
          {recall.resolution_notes && (
            <p className="text-sm text-iv-text mt-2">{recall.resolution_notes}</p>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================
// MAIN PAGE
// =============================================

interface ListResponse {
  success: boolean;
  data: ManufacturerRecall[];
  pagination: { total: number; limit: number; offset: number };
}

export default function RecallsPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('active');

  const { data, loading, error, refetch } = useFetch<ListResponse>(
    `/api/v1/recalls?status=${statusFilter}&limit=50`,
  );

  const recalls = data?.data ?? [];

  const handleCreate = useCallback(async (formData: RecallFormData) => {
    setSubmitting(true);
    try {
      const affectedModels = formData.affected_models
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      await apiFetch('/api/v1/recalls', {
        method: 'POST',
        body: JSON.stringify({
          title: formData.title,
          manufacturer: formData.manufacturer,
          affected_models: affectedModels,
          severity: formData.severity,
          description: formData.description,
          source_url: formData.source_url || undefined,
          source_reference: formData.source_reference || undefined,
          published_date: formData.published_date || undefined,
        }),
      });

      setShowForm(false);
      refetch();
    } catch (err) {
      console.error('Failed to create recall:', err);
    } finally {
      setSubmitting(false);
    }
  }, [refetch]);

  // If an ID is selected, show detail view
  if (selectedId) {
    return (
      <>
        <Helmet>
          <title>Recall Details — InspectVoice</title>
        </Helmet>
        <RecallDetail
          recallId={selectedId}
          onBack={() => setSearchParams({})}
        />
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>Manufacturer Recalls — InspectVoice</title>
        <meta name="description" content="Manage manufacturer recall notices and track affected assets." />
      </Helmet>

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
              <Bell className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-iv-text">Manufacturer Recalls</h1>
              <p className="text-xs text-iv-muted mt-0.5">Track recall notices and affected assets</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refetch}
              disabled={loading}
              className="iv-btn-icon"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="iv-btn-primary"
            >
              <Plus className="w-4 h-4" />
              New Recall
            </button>
          </div>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="iv-panel p-5">
            <h2 className="text-base font-semibold text-iv-text mb-4">New Recall Notice</h2>
            <RecallForm
              onSubmit={handleCreate}
              onCancel={() => setShowForm(false)}
              submitting={submitting}
            />
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-2">
          {(['active', 'resolved', 'dismissed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-iv-accent/15 text-iv-accent border-iv-accent/30'
                  : 'bg-iv-surface border-iv-border text-iv-muted hover:text-iv-text'
              }`}
            >
              {RECALL_STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-iv-muted" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-400">{error.message}</p>
          </div>
        )}

        {/* Recall List */}
        {data && recalls.length === 0 && (
          <div className="iv-panel p-8 text-center">
            <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-emerald-400">
              No {statusFilter} recalls
            </p>
            <p className="text-xs text-iv-muted mt-1">
              {statusFilter === 'active'
                ? 'No active manufacturer recalls affecting your assets.'
                : `No ${statusFilter} recalls found.`}
            </p>
          </div>
        )}

        {data && recalls.length > 0 && (
          <div className="space-y-2">
            {recalls.map((recall) => {
              const sevStyle = RECALL_SEVERITY_STYLES[recall.severity];

              return (
                <button
                  key={recall.id}
                  type="button"
                  onClick={() => setSearchParams({ id: recall.id })}
                  className="w-full text-left iv-panel p-4 hover:border-iv-accent/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold ${sevStyle.bg} ${sevStyle.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sevStyle.dot}`} />
                          {RECALL_SEVERITY_LABELS[recall.severity]}
                        </span>
                        <span className="text-sm font-medium text-iv-text line-clamp-1">{recall.title}</span>
                      </div>
                      <div className="flex items-center gap-2 text-2xs text-iv-muted">
                        <span>{recall.manufacturer}</span>
                        <span>·</span>
                        <span>{recall.matched_asset_count} asset{recall.matched_asset_count !== 1 ? 's' : ''} affected</span>
                        <span>·</span>
                        <span>{formatDate(recall.created_at)}</span>
                        {recall.source_reference && (
                          <>
                            <span>·</span>
                            <span className="font-mono">{recall.source_reference}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-iv-muted shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
