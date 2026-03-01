/**
 * InspectVoice — Defect Quick-Pick Bottom Sheet
 * Feature 15: Common defects picker during capture
 *
 * Usage in InspectionCapture.tsx:
 *   <DefectQuickPick
 *     assetType="swing"
 *     isOpen={showQuickPick}
 *     onClose={() => setShowQuickPick(false)}
 *     onSelect={(defect) => handleQuickPickSelect(defect)}
 *   />
 *
 * Shows top 12 defects for the asset type (sorted by usage).
 * Selecting an entry returns pre-filled fields for the capture form.
 * Records usage count on selection.
 *
 * When the library is empty or search yields no matches, the inspector
 * can add a custom defect via a validated inline form. Custom defects
 * are returned with null library IDs so they're clearly distinguishable
 * from library-sourced entries.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 *
 * FIX: 1 Mar 2026
 *   - Added CustomDefectForm so inspectors can manually enter defects
 *     when the defect library API is empty or search returns no results.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2,
  X,
  Search,
  AlertCircle,
  ChevronRight,
  BookOpen,
  Plus,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import {
  RISK_RATING_LABELS,
  RiskRating,
  ACTION_TIMEFRAME_LABELS,
  ActionTimeframe,
  COST_BAND_LABELS,
  CostBand,
} from '@/types';

// =============================================
// TYPES
// =============================================

export interface QuickPickItem {
  entry_id: string;
  version_id: string;
  title: string;
  description_template: string;
  bs_en_refs: readonly string[];
  severity_default: string;
  remedial_action_template: string;
  cost_band: string | null;
  timeframe_default: string | null;
  source: string;
  usage_count: number;
}

/** What gets returned to the parent on selection */
export interface QuickPickSelection {
  library_entry_id: string | null;
  library_entry_version_id: string | null;
  description: string;
  bs_en_reference: string;
  risk_rating: string;
  remedial_action: string;
  estimated_cost_band: string | null;
  action_timeframe: string | null;
}

interface DefectQuickPickProps {
  assetType: string;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: QuickPickSelection) => void;
}

// =============================================
// CONSTANTS
// =============================================

const DESCRIPTION_MIN = 5;
const DESCRIPTION_MAX = 1000;
const REMEDIAL_MAX = 1000;
const BS_EN_MAX = 200;

const SEVERITY_OPTIONS: { value: RiskRating; label: string }[] = [
  { value: RiskRating.LOW, label: RISK_RATING_LABELS[RiskRating.LOW] },
  { value: RiskRating.MEDIUM, label: RISK_RATING_LABELS[RiskRating.MEDIUM] },
  { value: RiskRating.HIGH, label: RISK_RATING_LABELS[RiskRating.HIGH] },
  { value: RiskRating.VERY_HIGH, label: RISK_RATING_LABELS[RiskRating.VERY_HIGH] },
];

const TIMEFRAME_OPTIONS: { value: ActionTimeframe; label: string }[] = [
  { value: ActionTimeframe.IMMEDIATE, label: ACTION_TIMEFRAME_LABELS[ActionTimeframe.IMMEDIATE] },
  { value: ActionTimeframe.URGENT, label: ACTION_TIMEFRAME_LABELS[ActionTimeframe.URGENT] },
  { value: ActionTimeframe.ROUTINE, label: ACTION_TIMEFRAME_LABELS[ActionTimeframe.ROUTINE] },
  { value: ActionTimeframe.PLANNED, label: ACTION_TIMEFRAME_LABELS[ActionTimeframe.PLANNED] },
];

const COST_BAND_OPTIONS: { value: CostBand; label: string }[] = [
  { value: CostBand.LOW, label: COST_BAND_LABELS[CostBand.LOW] },
  { value: CostBand.MEDIUM, label: COST_BAND_LABELS[CostBand.MEDIUM] },
  { value: CostBand.HIGH, label: COST_BAND_LABELS[CostBand.HIGH] },
  { value: CostBand.VERY_HIGH, label: COST_BAND_LABELS[CostBand.VERY_HIGH] },
];

// =============================================
// HELPERS
// =============================================

function severityDot(severity: string): string {
  switch (severity) {
    case 'very_high': return 'bg-[#EF4444]';
    case 'high': return 'bg-[#F97316]';
    case 'medium': return 'bg-[#EAB308]';
    case 'low': return 'bg-[#22C55E]';
    default: return 'bg-[#2A2F3A]';
  }
}

/** Sanitise free text — strip control chars, collapse whitespace, trim */
function sanitiseText(raw: string, maxLength: number): string {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

// =============================================
// CUSTOM DEFECT FORM
// =============================================

interface CustomDefectFormProps {
  onSubmit: (selection: QuickPickSelection) => void;
  onCancel: () => void;
}

function CustomDefectForm({ onSubmit, onCancel }: CustomDefectFormProps): JSX.Element {
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<RiskRating>(RiskRating.MEDIUM);
  const [remedialAction, setRemedialAction] = useState('');
  const [bsEnRef, setBsEnRef] = useState('');
  const [timeframe, setTimeframe] = useState<ActionTimeframe>(ActionTimeframe.ROUTINE);
  const [costBand, setCostBand] = useState<CostBand>(CostBand.LOW);
  const [touched, setTouched] = useState(false);

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    descriptionRef.current?.focus();
  }, []);

  const trimmedDesc = description.trim();
  const descriptionValid = trimmedDesc.length >= DESCRIPTION_MIN && trimmedDesc.length <= DESCRIPTION_MAX;
  const canSubmit = descriptionValid;

  const handleSubmit = useCallback(() => {
    setTouched(true);
    if (!canSubmit) return;

    onSubmit({
      library_entry_id: null,
      library_entry_version_id: null,
      description: sanitiseText(description, DESCRIPTION_MAX),
      bs_en_reference: sanitiseText(bsEnRef, BS_EN_MAX),
      risk_rating: severity,
      remedial_action: sanitiseText(remedialAction, REMEDIAL_MAX),
      estimated_cost_band: costBand,
      action_timeframe: timeframe,
    });
  }, [canSubmit, description, severity, remedialAction, bsEnRef, timeframe, costBand, onSubmit]);

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold iv-text flex items-center gap-2">
          <Plus className="w-4 h-4 text-[#22C55E]" />
          Add Custom Defect
        </h4>
        <button type="button" onClick={onCancel} className="text-xs iv-muted hover:iv-text transition-colors">
          Cancel
        </button>
      </div>

      {/* Description — required */}
      <div>
        <label htmlFor="defect-desc" className="iv-label text-xs block mb-1">
          Description <span className="text-red-400">*</span>
        </label>
        <textarea
          ref={descriptionRef}
          id="defect-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. Surface corrosion on chain link connections"
          rows={2}
          maxLength={DESCRIPTION_MAX}
          className="iv-input w-full text-sm resize-y"
          aria-required="true"
          aria-invalid={touched && !descriptionValid}
        />
        {touched && !descriptionValid && (
          <p className="mt-0.5 text-2xs text-red-400" role="alert">
            {trimmedDesc.length < DESCRIPTION_MIN
              ? `At least ${DESCRIPTION_MIN} characters required`
              : `Maximum ${DESCRIPTION_MAX} characters`}
          </p>
        )}
        <p className="text-2xs iv-muted mt-0.5 text-right">{trimmedDesc.length}/{DESCRIPTION_MAX}</p>
      </div>

      {/* Severity + Timeframe row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="defect-severity" className="iv-label text-xs block mb-1">
            Risk Rating
          </label>
          <select
            id="defect-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as RiskRating)}
            className="iv-input w-full text-sm"
          >
            {SEVERITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="defect-timeframe" className="iv-label text-xs block mb-1">
            Action Timeframe
          </label>
          <select
            id="defect-timeframe"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as ActionTimeframe)}
            className="iv-input w-full text-sm"
          >
            {TIMEFRAME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Cost Band */}
      <div>
        <label htmlFor="defect-cost" className="iv-label text-xs block mb-1">
          Cost Band
        </label>
        <select
          id="defect-cost"
          value={costBand}
          onChange={(e) => setCostBand(e.target.value as CostBand)}
          className="iv-input w-full text-sm"
        >
          {COST_BAND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Remedial Action — optional */}
      <div>
        <label htmlFor="defect-remedial" className="iv-label text-xs block mb-1">
          Remedial Action
        </label>
        <textarea
          id="defect-remedial"
          value={remedialAction}
          onChange={(e) => setRemedialAction(e.target.value)}
          placeholder="e.g. Sand affected area and apply rust inhibitor"
          rows={2}
          maxLength={REMEDIAL_MAX}
          className="iv-input w-full text-sm resize-y"
        />
      </div>

      {/* BS EN Reference — optional */}
      <div>
        <label htmlFor="defect-bsen" className="iv-label text-xs block mb-1">
          BS EN Reference
        </label>
        <input
          id="defect-bsen"
          type="text"
          value={bsEnRef}
          onChange={(e) => setBsEnRef(e.target.value)}
          placeholder="e.g. BS EN 1176-2:2017 Cl.4.2.8.5"
          maxLength={BS_EN_MAX}
          className="iv-input w-full text-sm"
        />
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={touched && !canSubmit}
        className="iv-btn-primary w-full text-xs py-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Add Defect
      </button>
    </div>
  );
}

// =============================================
// MAIN COMPONENT
// =============================================

export default function DefectQuickPick({
  assetType,
  isOpen,
  onClose,
  onSelect,
}: DefectQuickPickProps): JSX.Element | null {
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<QuickPickItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);

  // ── Fetch quick-pick items ──
  const fetchItems = useCallback(async () => {
    if (!assetType) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/v1/defect-library/quick-pick/${encodeURIComponent(assetType)}?limit=12`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json() as { data: QuickPickItem[] };
        setItems(json.data);
      }
    } catch {
      // Silent — non-critical feature
    } finally {
      setLoading(false);
    }
  }, [getToken, assetType]);

  useEffect(() => {
    if (isOpen) {
      void fetchItems();
      setSearchQuery('');
      setExpandedId(null);
      setShowCustomForm(false);
    }
  }, [isOpen, fetchItems]);

  // ── Record usage + select ──
  const handleSelect = useCallback(async (item: QuickPickItem) => {
    // Fire-and-forget usage recording
    try {
      const token = await getToken();
      void fetch(`/api/v1/defect-library/${encodeURIComponent(item.entry_id)}/record-usage`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Silent
    }

    onSelect({
      library_entry_id: item.entry_id,
      library_entry_version_id: item.version_id,
      description: item.description_template,
      bs_en_reference: item.bs_en_refs.join('; '),
      risk_rating: item.severity_default,
      remedial_action: item.remedial_action_template,
      estimated_cost_band: item.cost_band,
      action_timeframe: item.timeframe_default,
    });

    onClose();
  }, [getToken, onSelect, onClose]);

  // ── Custom defect submitted ──
  const handleCustomSubmit = useCallback(
    (selection: QuickPickSelection) => {
      onSelect(selection);
      onClose();
    },
    [onSelect, onClose],
  );

  // ── Filter by search ──
  const filtered = searchQuery
    ? items.filter(
        (i) =>
          i.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          i.description_template.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : items;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm">
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Bottom sheet */}
      <div className="relative w-full max-w-lg bg-iv-surface border-t border-iv-border rounded-t-2xl max-h-[75vh] flex flex-col animate-slide-up">
        {/* Handle bar */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-iv-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-iv-border">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-iv-accent" />
            <h3 className="text-sm font-semibold iv-text">
              {showCustomForm ? 'Add Custom Defect' : 'Common Defects'}
            </h3>
            {!showCustomForm && (
              <span className="text-2xs iv-muted">({filtered.length})</span>
            )}
          </div>
          <button type="button" onClick={onClose} className="iv-btn-icon">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search (hidden when custom form is open) */}
        {!showCustomForm && (
          <div className="px-4 py-2 border-b border-iv-border">
            <div className="relative">
              <Search className="w-4 h-4 iv-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search defects..."
                className="iv-input w-full text-sm py-2 pl-8"
                autoFocus
              />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {showCustomForm ? (
            <CustomDefectForm
              onSubmit={handleCustomSubmit}
              onCancel={() => setShowCustomForm(false)}
            />
          ) : loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 iv-muted animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 px-4">
              <AlertCircle className="w-8 h-8 iv-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm iv-muted mb-4">
                {searchQuery ? 'No matching defects found.' : 'No common defects for this asset type.'}
              </p>
              <button
                type="button"
                onClick={() => setShowCustomForm(true)}
                className="iv-btn-primary inline-flex items-center gap-2 text-xs py-2 px-4"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Custom Defect
              </button>
            </div>
          ) : (
            <div className="space-y-1.5 px-4 py-2">
              {filtered.map((item) => {
                const isExpanded = expandedId === item.entry_id;
                return (
                  <div key={item.entry_id} className="iv-panel overflow-hidden">
                    {/* Summary row */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.entry_id)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-iv-surface-2/50 transition-colors"
                    >
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${severityDot(item.severity_default)}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium iv-text truncate">{item.title}</p>
                        <p className="text-2xs iv-muted">
                          {RISK_RATING_LABELS[item.severity_default as RiskRating] ?? item.severity_default}
                          {item.cost_band && ` · ${COST_BAND_LABELS[item.cost_band as CostBand] ?? item.cost_band}`}
                          {item.timeframe_default && ` · ${ACTION_TIMEFRAME_LABELS[item.timeframe_default as ActionTimeframe] ?? item.timeframe_default}`}
                        </p>
                      </div>
                      <ChevronRight className={`w-4 h-4 iv-muted flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-iv-border/50 pt-2 space-y-2">
                        <div>
                          <p className="text-2xs iv-muted mb-0.5">Description</p>
                          <p className="text-xs iv-text">{item.description_template}</p>
                        </div>
                        {item.bs_en_refs.length > 0 && (
                          <div>
                            <p className="text-2xs iv-muted mb-0.5">BS EN References</p>
                            <p className="text-xs text-iv-accent">{item.bs_en_refs.join(', ')}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-2xs iv-muted mb-0.5">Remedial Action</p>
                          <p className="text-xs iv-text">{item.remedial_action_template}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSelect(item)}
                          className="iv-btn-primary w-full text-xs py-2 mt-2"
                        >
                          Use This Defect
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-iv-border">
          {!showCustomForm ? (
            <div className="flex items-center justify-between">
              <p className="text-2xs iv-muted">
                Tap to expand · All fields are editable after selection
              </p>
              {filtered.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCustomForm(true)}
                  className="text-2xs text-[#22C55E] hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Custom
                </button>
              )}
            </div>
          ) : (
            <p className="text-2xs iv-muted text-center">
              All fields except description are optional
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
