/**
 * InspectVoice — Manufacturer Recall Types (Feature 17)
 * src/types/recalls.ts
 *
 * Type definitions for manufacturer recall hooks.
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

// =============================================
// ENUMS
// =============================================

export type RecallSeverity = 'critical' | 'high' | 'medium' | 'advisory';
export type RecallStatus = 'active' | 'resolved' | 'dismissed';
export type RecallMatchConfidence = 'exact' | 'partial' | 'manual';
export type RecallMatchStatus =
  | 'unacknowledged'
  | 'acknowledged'
  | 'inspected'
  | 'withdrawn'
  | 'replaced'
  | 'not_affected';

export const RECALL_SEVERITY_LABELS: Record<RecallSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  advisory: 'Advisory',
};

export const RECALL_SEVERITY_ORDER: readonly RecallSeverity[] = [
  'critical',
  'high',
  'medium',
  'advisory',
] as const;

export const RECALL_STATUS_LABELS: Record<RecallStatus, string> = {
  active: 'Active',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

export const RECALL_MATCH_STATUS_LABELS: Record<RecallMatchStatus, string> = {
  unacknowledged: 'Unacknowledged',
  acknowledged: 'Acknowledged',
  inspected: 'Inspected',
  withdrawn: 'Withdrawn',
  replaced: 'Replaced',
  not_affected: 'Not Affected',
};

export const RECALL_MATCH_CONFIDENCE_LABELS: Record<RecallMatchConfidence, string> = {
  exact: 'Exact Match',
  partial: 'Partial Match',
  manual: 'Manual Entry',
};

// =============================================
// ENTITIES
// =============================================

export interface ManufacturerRecall {
  readonly id: string;
  readonly org_id: string;
  readonly title: string;
  readonly manufacturer: string;
  readonly affected_models: readonly string[];
  readonly severity: RecallSeverity;
  readonly description: string;
  readonly source_url: string | null;
  readonly source_reference: string | null;
  readonly published_date: string | null;
  readonly status: RecallStatus;
  readonly resolved_at: string | null;
  readonly resolved_by: string | null;
  readonly resolution_notes: string | null;
  readonly matched_asset_count: number;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RecallAssetMatch {
  readonly id: string;
  readonly org_id: string;
  readonly recall_id: string;
  readonly asset_id: string;
  readonly site_id: string;
  readonly match_reason: string;
  readonly match_confidence: RecallMatchConfidence;
  readonly status: RecallMatchStatus;
  readonly acknowledged_by: string | null;
  readonly acknowledged_at: string | null;
  readonly action_taken: string | null;
  readonly action_taken_by: string | null;
  readonly action_taken_at: string | null;
  readonly notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  // Joined fields (from GET /recalls/:id)
  readonly asset_code?: string;
  readonly asset_type?: string;
  readonly asset_manufacturer?: string;
  readonly asset_model?: string;
  readonly site_name?: string;
}

export interface RecallWithMatches extends ManufacturerRecall {
  readonly matches: readonly RecallAssetMatch[];
}

// =============================================
// DASHBOARD ALERT (lightweight, for banners)
// =============================================

export interface RecallAlert {
  readonly id: string;
  readonly title: string;
  readonly manufacturer: string;
  readonly severity: RecallSeverity;
  readonly matched_asset_count: number;
  readonly unacknowledged_count: number;
  readonly created_at: string;
}

// =============================================
// ASSET RECALL (for AssetDetail banner)
// =============================================

export interface AssetRecallMatch {
  readonly match_id: string;
  readonly match_reason: string;
  readonly match_confidence: RecallMatchConfidence;
  readonly match_status: RecallMatchStatus;
  readonly acknowledged_at: string | null;
  readonly action_taken: string | null;
  readonly notes: string | null;
  readonly recall_id: string;
  readonly title: string;
  readonly manufacturer: string;
  readonly severity: RecallSeverity;
  readonly description: string;
  readonly source_url: string | null;
  readonly source_reference: string | null;
  readonly published_date: string | null;
  readonly recall_status: RecallStatus;
}

// =============================================
// API REQUEST SHAPES
// =============================================

export interface CreateRecallRequest {
  readonly title: string;
  readonly manufacturer: string;
  readonly affected_models?: readonly string[];
  readonly severity?: RecallSeverity;
  readonly description: string;
  readonly source_url?: string;
  readonly source_reference?: string;
  readonly published_date?: string;
}

export interface UpdateRecallRequest {
  readonly title?: string;
  readonly manufacturer?: string;
  readonly affected_models?: readonly string[];
  readonly severity?: RecallSeverity;
  readonly description?: string;
  readonly source_url?: string;
  readonly source_reference?: string;
  readonly published_date?: string;
  readonly status?: RecallStatus;
  readonly resolution_notes?: string;
}

export interface UpdateRecallMatchRequest {
  readonly status: RecallMatchStatus;
  readonly action_taken?: string;
  readonly notes?: string;
}

// =============================================
// STYLE MAPS
// =============================================

export const RECALL_SEVERITY_STYLES: Record<RecallSeverity, { bg: string; text: string; dot: string; border: string }> = {
  critical: { bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-400', border: 'border-red-500/30' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-400', dot: 'bg-orange-400', border: 'border-orange-500/30' },
  medium: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', dot: 'bg-yellow-400', border: 'border-yellow-500/30' },
  advisory: { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: 'bg-blue-400', border: 'border-blue-500/30' },
};

export const RECALL_MATCH_STATUS_STYLES: Record<RecallMatchStatus, { bg: string; text: string }> = {
  unacknowledged: { bg: 'bg-red-500/15', text: 'text-red-400' },
  acknowledged: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  inspected: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  withdrawn: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  replaced: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  not_affected: { bg: 'bg-iv-muted/15', text: 'text-iv-muted' },
};
