/**
 * InspectVoice — Defect Library Management Page
 * Feature 15: Browse, create, edit org entries, view version history
 *
 * Route: /defect-library
 * RBAC: all members can browse; org:admin + org:manager can create/edit org entries
 *
 * Shows:
 *   - Filter bar: asset type, source (system/org), search
 *   - Table: title, asset type, severity, source, usage count, actions
 *   - Create/edit form (org entries only, system are read-only)
 *   - Version history drawer
 *   - Seed button (admin only, one-time)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  BookOpen,
  Plus,
  Search,
  Filter,
  Edit,
  History,
  Trash2,
  X,
  Database,
  Building2,
  Shield,
  Save,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { ASSET_TYPE_CONFIG } from '@config/assetTypes';
import {
  RISK_RATING_LABELS,
  RiskRating,
  ACTION_TIMEFRAME_LABELS,
  COST_BAND_LABELS,
} from '@/types';
import type { DefectLibraryEntry, DefectLibraryEntryVersion } from '@/types/features14_15';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// =============================================
// TYPES
// =============================================

interface FormData {
  asset_type: string;
  title: string;
  description_template: string;
  bs_en_refs: string;
  severity_default: string;
  remedial_action_template: string;
  cost_band: string;
  timeframe_default: string;
  change_note: string;
}

const EMPTY_FORM: FormData = {
  asset_type: '',
  title: '',
  description_template: '',
  bs_en_refs: '',
  severity_default: 'medium',
  remedial_action_template: '',
  cost_band: '',
  timeframe_default: '',
  change_note: '',
};

// =============================================
// HELPERS
// =============================================

function severityBadge(severity: string): JSX.Element {
  const config: Record<string, string> = {
    very_high: 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30',
    high: 'bg-[#F97316]/15 text-[#F97316] border-[#F97316]/30',
    medium: 'bg-[#EAB308]/15 text-[#EAB308] border-[#EAB308]/30',
    low: 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30',
  };
  const cls = config[severity] ?? config['medium']!;
  const label = RISK_RATING_LABELS[severity as RiskRating] ?? severity;
  return (
    <span className={`text-2xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

function sourceBadge(source: string): JSX.Element {
  if (source === 'system') {
    return (
      <span className="flex items-center gap-1 text-2xs font-medium text-iv-accent">
        <Database className="w-3 h-3" /> System
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-2xs font-medium text-[#EAB308]">
      <Building2 className="w-3 h-3" /> Org
    </span>
  );
}

// =============================================
// COMPONENT
// =============================================

export default function DefectLibraryPage(): JSX.Element {
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<DefectLibraryEntry[]>([]);
  const [total, setTotal] = useState(0);

  // Filters
  const [assetTypeFilter, setAssetTypeFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Pagination
  const [offset, setOffset] = useState(0);
  const limit = 20;

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Version history
  const [historyEntryId, setHistoryEntryId] = useState<string | null>(null);
  const [historyVersions, setHistoryVersions] = useState<DefectLibraryEntryVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Seed
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);

  // ── Fetch entries ──
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (assetTypeFilter) params.set('asset_type', assetTypeFilter);
      if (sourceFilter) params.set('source', sourceFilter);
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`${API_BASE}/api/v1/defect-library?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json() as {
        data: DefectLibraryEntry[];
        pagination: { total: number };
      };
      setEntries(json.data);
      setTotal(json.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken, offset, assetTypeFilter, sourceFilter, searchQuery]);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  // ── Search submit ──
  const handleSearch = useCallback(() => {
    setOffset(0);
    setSearchQuery(searchInput);
  }, [searchInput]);

  // ── Create / Edit form ──
  const openCreateForm = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }, []);

  const openEditForm = useCallback((entry: DefectLibraryEntry) => {
    const v = entry.current_version;
    setEditingId(entry.id);
    setForm({
      asset_type: entry.asset_type,
      title: entry.title,
      description_template: v?.description_template ?? '',
      bs_en_refs: v?.bs_en_refs.join(', ') ?? '',
      severity_default: v?.severity_default ?? 'medium',
      remedial_action_template: v?.remedial_action_template ?? '',
      cost_band: v?.cost_band ?? '',
      timeframe_default: v?.timeframe_default ?? '',
      change_note: '',
    });
    setFormError(null);
    setShowForm(true);
  }, []);

  const handleFormSubmit = useCallback(async () => {
    if (!form.title || !form.asset_type || !form.description_template || !form.remedial_action_template) {
      setFormError('Title, asset type, description, and remedial action are required.');
      return;
    }

    setFormSaving(true);
    setFormError(null);
    try {
      const token = await getToken();
      const body = {
        asset_type: form.asset_type,
        title: form.title,
        description_template: form.description_template,
        bs_en_refs: form.bs_en_refs.split(',').map((s) => s.trim()).filter(Boolean),
        severity_default: form.severity_default,
        remedial_action_template: form.remedial_action_template,
        cost_band: form.cost_band || null,
        timeframe_default: form.timeframe_default || null,
        change_note: form.change_note || (editingId ? 'Updated' : 'Initial version'),
      };

      const url = editingId
        ? `${API_BASE}/api/v1/defect-library/${editingId}`
        : `${API_BASE}/api/v1/defect-library`;
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errJson = await res.json() as { error?: { message?: string } };
        throw new Error(errJson.error?.message ?? `${res.status}`);
      }

      setShowForm(false);
      void fetchEntries();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setFormSaving(false);
    }
  }, [form, editingId, getToken, fetchEntries]);

  // ── Delete ──
  const handleDelete = useCallback(async (entryId: string) => {
    if (!confirm('Deactivate this org entry? It can be restored later.')) return;
    try {
      const token = await getToken();
      await fetch(`${API_BASE}/api/v1/defect-library/${entryId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      void fetchEntries();
    } catch {
      // silent
    }
  }, [getToken, fetchEntries]);

  // ── Version history ──
  const openHistory = useCallback(async (entryId: string) => {
    setHistoryEntryId(entryId);
    setHistoryLoading(true);
    setHistoryVersions([]);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/v1/defect-library/${entryId}/versions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json() as { data: DefectLibraryEntryVersion[] };
        setHistoryVersions(json.data);
      }
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, [getToken]);

  // ── Seed ──
  const handleSeed = useCallback(async () => {
    setSeeding(true);
    setSeedResult(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/v1/defect-library/seed`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json() as { data: { created: number; skipped: number; total: number } };
      const d = json.data;
      setSeedResult(`Created ${d.created}, skipped ${d.skipped} (${d.total} total in library)`);
    } catch {
      setSeedResult('Seed failed');
    } finally {
      setSeeding(false);
    }
  }, [getToken]);

  // ── Update form field helper ──
  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Asset type options
  const assetTypeOptions = Object.entries(ASSET_TYPE_CONFIG).map(([key, cfg]) => ({
    value: key,
    label: cfg.name,
  }));

  // ── Render ──
  return (
    <div className="max-w-6xl mx-auto">
      <Helmet>
        <title>Defect Library | InspectVoice</title>
        <meta name="description" content="Manage defect templates and recommendations library." />
      </Helmet>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/settings" className="iv-btn-icon" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold iv-text flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-iv-accent" />
              Defect Library
            </h1>
            <p className="text-sm iv-muted">{total} entries</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleSeed} disabled={seeding} className="iv-btn-secondary text-xs flex items-center gap-1.5">
            {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
            Seed System Entries
          </button>
          <button type="button" onClick={openCreateForm} className="iv-btn-primary text-xs flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Add Org Entry
          </button>
        </div>
      </div>

      {seedResult && (
        <div className="iv-panel p-3 mb-4 text-sm iv-text">{seedResult}</div>
      )}

      {/* Filter bar */}
      <div className="iv-panel p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 iv-muted" />
            <select
              value={assetTypeFilter}
              onChange={(e) => { setAssetTypeFilter(e.target.value); setOffset(0); }}
              className="iv-input text-xs py-1.5"
            >
              <option value="">All Asset Types</option>
              {assetTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <select
            value={sourceFilter}
            onChange={(e) => { setSourceFilter(e.target.value); setOffset(0); }}
            className="iv-input text-xs py-1.5"
          >
            <option value="">All Sources</option>
            <option value="system">System</option>
            <option value="org">Org Custom</option>
          </select>

          <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 iv-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search defects..."
                className="iv-input w-full text-xs py-1.5 pl-8"
              />
            </div>
            <button type="button" onClick={handleSearch} className="iv-btn-secondary text-xs px-3 py-1.5">
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 iv-muted animate-spin" />
        </div>
      ) : error ? (
        <div className="iv-panel p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-2" />
          <p className="iv-muted text-sm">{error}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="iv-panel p-8 text-center">
          <BookOpen className="w-12 h-12 iv-muted mx-auto mb-3 opacity-50" />
          <p className="iv-muted text-sm">No entries found. Try adjusting filters or seed system entries.</p>
        </div>
      ) : (
        <div className="iv-panel overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-iv-border">
                <th className="text-left px-4 py-3 text-xs iv-muted font-medium">Title</th>
                <th className="text-left px-3 py-3 text-xs iv-muted font-medium">Asset Type</th>
                <th className="text-center px-3 py-3 text-xs iv-muted font-medium">Severity</th>
                <th className="text-center px-3 py-3 text-xs iv-muted font-medium">Source</th>
                <th className="text-right px-3 py-3 text-xs iv-muted font-medium">Used</th>
                <th className="px-3 py-3 text-xs iv-muted font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const v = entry.current_version;
                const config = ASSET_TYPE_CONFIG[entry.asset_type];
                return (
                  <tr key={entry.id} className="border-b border-iv-border/30 hover:bg-iv-surface-2/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium iv-text">{entry.title}</p>
                      {v && (
                        <p className="text-xs iv-muted truncate max-w-[300px]">{v.description_template}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs iv-text">
                      {config?.name ?? entry.asset_type}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {v && severityBadge(v.severity_default)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {sourceBadge(entry.source)}
                    </td>
                    <td className="px-3 py-3 text-right text-xs iv-muted">
                      {entry.usage_count}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void openHistory(entry.id)}
                          className="iv-btn-icon opacity-60 hover:opacity-100"
                          title="Version history"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        {entry.source === 'org' && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditForm(entry)}
                              className="iv-btn-icon opacity-60 hover:opacity-100"
                              title="Edit"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(entry.id)}
                              className="iv-btn-icon opacity-60 hover:opacity-100 text-red-400"
                              title="Deactivate"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {entry.source === 'system' && (
                          <span title="System entry (read-only)">
                            <Shield className="w-3.5 h-3.5 iv-muted opacity-40" />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-iv-border">
              <p className="text-xs iv-muted">
                {offset + 1}–{Math.min(offset + limit, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="iv-btn-secondary text-xs disabled:opacity-30"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= total}
                  className="iv-btn-secondary text-xs disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Create/Edit Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8">
          <div className="iv-panel p-6 max-w-lg w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold iv-text">
                {editingId ? 'Edit Library Entry' : 'New Org Entry'}
              </h3>
              <button type="button" onClick={() => setShowForm(false)} className="iv-btn-icon">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                {formError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="iv-label mb-1 block">Asset Type *</label>
                <select
                  value={form.asset_type}
                  onChange={(e) => updateField('asset_type', e.target.value)}
                  className="iv-input w-full text-sm"
                  disabled={!!editingId}
                >
                  <option value="">Select...</option>
                  {assetTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="iv-label mb-1 block">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  className="iv-input w-full text-sm"
                  placeholder="Short defect title"
                  maxLength={200}
                />
              </div>

              <div>
                <label className="iv-label mb-1 block">Description Template *</label>
                <textarea
                  value={form.description_template}
                  onChange={(e) => updateField('description_template', e.target.value)}
                  className="iv-input w-full text-sm resize-y"
                  rows={3}
                  placeholder="Use [LOCATION], [SIZE], etc. for placeholders"
                  maxLength={2000}
                />
              </div>

              <div>
                <label className="iv-label mb-1 block">BS EN References</label>
                <input
                  type="text"
                  value={form.bs_en_refs}
                  onChange={(e) => updateField('bs_en_refs', e.target.value)}
                  className="iv-input w-full text-sm"
                  placeholder="Comma-separated, e.g. BS EN 1176-1:2017 §4.2.4"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="iv-label mb-1 block">Severity *</label>
                  <select
                    value={form.severity_default}
                    onChange={(e) => updateField('severity_default', e.target.value)}
                    className="iv-input w-full text-sm"
                  >
                    {Object.entries(RISK_RATING_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="iv-label mb-1 block">Cost Band</label>
                  <select
                    value={form.cost_band}
                    onChange={(e) => updateField('cost_band', e.target.value)}
                    className="iv-input w-full text-sm"
                  >
                    <option value="">Not set</option>
                    {Object.entries(COST_BAND_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="iv-label mb-1 block">Remedial Action *</label>
                <textarea
                  value={form.remedial_action_template}
                  onChange={(e) => updateField('remedial_action_template', e.target.value)}
                  className="iv-input w-full text-sm resize-y"
                  rows={2}
                  maxLength={2000}
                />
              </div>

              <div>
                <label className="iv-label mb-1 block">Action Timeframe</label>
                <select
                  value={form.timeframe_default}
                  onChange={(e) => updateField('timeframe_default', e.target.value)}
                  className="iv-input w-full text-sm"
                >
                  <option value="">Not set</option>
                  {Object.entries(ACTION_TIMEFRAME_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              {editingId && (
                <div>
                  <label className="iv-label mb-1 block">Change Note</label>
                  <input
                    type="text"
                    value={form.change_note}
                    onChange={(e) => updateField('change_note', e.target.value)}
                    className="iv-input w-full text-sm"
                    placeholder="What changed and why"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                type="button"
                onClick={() => void handleFormSubmit()}
                disabled={formSaving}
                className="iv-btn-primary flex items-center gap-2 flex-1 justify-center"
              >
                {formSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingId ? 'Save New Version' : 'Create Entry'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="iv-btn-secondary flex-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Version History Drawer ── */}
      {historyEntryId && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/40 backdrop-blur-sm">
          <div className="h-full w-full max-w-md bg-iv-surface border-l border-iv-border overflow-y-auto">
            <div className="sticky top-0 bg-iv-surface border-b border-iv-border p-4 flex items-center justify-between z-10">
              <h3 className="text-base font-semibold iv-text flex items-center gap-2">
                <History className="w-4 h-4 text-iv-accent" />
                Version History
              </h3>
              <button
                type="button"
                onClick={() => setHistoryEntryId(null)}
                className="iv-btn-icon"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 iv-muted animate-spin" />
                </div>
              ) : historyVersions.length === 0 ? (
                <p className="iv-muted text-sm text-center py-8">No version history available.</p>
              ) : (
                <div className="space-y-4">
                  {historyVersions.map((v) => (
                    <div key={v.id} className="iv-panel p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-iv-accent">v{v.version}</span>
                        <span className="text-2xs iv-muted">
                          {new Date(v.created_at).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {v.change_note && (
                        <p className="text-xs iv-muted italic mb-2">{v.change_note}</p>
                      )}
                      <div className="space-y-1.5 text-xs">
                        <div>
                          <span className="iv-muted">Severity:</span>{' '}
                          {severityBadge(v.severity_default)}
                        </div>
                        <div>
                          <span className="iv-muted">Description:</span>
                          <p className="iv-text mt-0.5">{v.description_template}</p>
                        </div>
                        <div>
                          <span className="iv-muted">Remedial:</span>
                          <p className="iv-text mt-0.5">{v.remedial_action_template}</p>
                        </div>
                        {v.bs_en_refs.length > 0 && (
                          <div>
                            <span className="iv-muted">BS EN Refs:</span>
                            <p className="iv-text mt-0.5">{v.bs_en_refs.join(', ')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
