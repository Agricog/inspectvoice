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
 * Shows top 8 defects for the asset type (sorted by usage).
 * Selecting an entry returns pre-filled fields for the capture form.
 * Records usage count on selection.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  X,
  Search,
  AlertCircle,
  ChevronRight,
  BookOpen,
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
  library_entry_id: string;
  library_entry_version_id: string;
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

// =============================================
// COMPONENT
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

  // ── Fetch quick-pick items ──
  const fetchItems = useCallback(async () => {
    if (!assetType) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/v1/defect-library/quick-pick/${assetType}?limit=12`, {
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
    }
  }, [isOpen, fetchItems]);

  // ── Record usage + select ──
  const handleSelect = useCallback(async (item: QuickPickItem) => {
    // Fire-and-forget usage recording
    try {
      const token = await getToken();
      void fetch(`/api/v1/defect-library/${item.entry_id}/record-usage`, {
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
            <h3 className="text-sm font-semibold iv-text">Common Defects</h3>
            <span className="text-2xs iv-muted">({filtered.length})</span>
          </div>
          <button type="button" onClick={onClose} className="iv-btn-icon">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
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

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 iv-muted animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="w-8 h-8 iv-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm iv-muted">
                {searchQuery ? 'No matching defects found.' : 'No common defects for this asset type.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
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

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-iv-border">
          <p className="text-2xs iv-muted text-center">
            Tap to expand · All fields are editable after selection
          </p>
        </div>
      </div>
    </div>
  );
}
