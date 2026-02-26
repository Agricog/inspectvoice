/**
 * InspectVoice — Feature 14 & 15 Type Definitions
 * Inspector Performance & Defect Library
 *
 * Shared across frontend pages + Worker route handlers.
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import type { RiskRating, ActionTimeframe, CostBand, InspectionType } from './enums';

// =============================================
// FEATURE 14: INSPECTOR PERFORMANCE
// =============================================

/** Period granularity for metrics aggregation */
export type MetricsPeriodType = 'day' | 'week' | 'month' | 'quarter';

/** Precomputed metrics for one inspector × one period */
export interface InspectorMetricsPeriod {
  readonly id: string;
  readonly org_id: string;
  readonly inspector_user_id: string;

  readonly period_type: MetricsPeriodType;
  readonly period_start: string;   // ISO date
  readonly period_end: string;     // ISO date
  readonly inspection_type: InspectionType | null;

  // Core metrics
  readonly inspections_completed: number;
  readonly completeness_avg: number | null;
  readonly completeness_counts: CompletenessHistogram;
  readonly defects_total: number;
  readonly defects_per_inspection_avg: number | null;
  readonly photo_compliance_pct: number | null;
  readonly normalisation_accept_rate: number | null;
  readonly avg_time_to_signoff_seconds: number | null;
  readonly overdue_rate: number | null;
  readonly makesafe_initiated_count: number;
  readonly makesafe_completed_count: number;

  // Extended metrics
  readonly rework_rate: number | null;
  readonly critical_response_avg_seconds: number | null;
  readonly evidence_quality_pct: number | null;
  readonly completeness_variance: number | null;
  readonly audit_flag_count: number;

  readonly computed_at: string;
  readonly source_version: string;
}

/** A–F grade distribution */
export interface CompletenessHistogram {
  readonly A: number;
  readonly B: number;
  readonly C: number;
  readonly D: number;
  readonly E: number;
  readonly F: number;
}

/** Row in the manager overview table */
export interface InspectorOverviewRow {
  readonly inspector_user_id: string;
  readonly inspector_name: string;
  readonly inspector_email: string;
  readonly inspections_completed: number;
  readonly completeness_avg: number | null;
  readonly overdue_rate: number | null;
  readonly avg_time_to_signoff_seconds: number | null;
  readonly photo_compliance_pct: number | null;
  readonly evidence_quality_pct: number | null;
  readonly makesafe_initiated_count: number;
  readonly makesafe_completed_count: number;
  readonly rework_rate: number | null;
  readonly audit_flag_count: number;
}

/** Trend direction for sparkline/badge display */
export type TrendDirection = 'improving' | 'stable' | 'declining';

/** Single data point for trend charts */
export interface TrendDataPoint {
  readonly period_start: string;
  readonly value: number | null;
}

/** Trend series for a single metric over time */
export interface MetricTrend {
  readonly metric_key: string;
  readonly label: string;
  readonly unit: string;     // '%', 'count', 'minutes', 'grade'
  readonly direction: TrendDirection;
  readonly current_value: number | null;
  readonly previous_value: number | null;
  readonly data_points: readonly TrendDataPoint[];
}

/** Inspector detail response — KPIs + trends + breakdown */
export interface InspectorDetailResponse {
  readonly inspector_user_id: string;
  readonly inspector_name: string;
  readonly period_type: MetricsPeriodType;
  readonly period_start: string;
  readonly period_end: string;
  readonly current: InspectorMetricsPeriod | null;
  readonly trends: readonly MetricTrend[];
  readonly by_inspection_type: readonly InspectorMetricsPeriod[];
}

/** "Your Month" shareable link */
export interface PerformanceShareLink {
  readonly id: string;
  readonly inspector_user_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly token: string;       // unhashed, returned only at creation
  readonly expires_at: string;
  readonly created_by_user_id: string;
}

/** Available time period presets for the UI filter bar */
export type PeriodPreset = 'last_7_days' | 'month' | 'quarter' | 'ytd' | 'rolling_90' | 'custom';

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  last_7_days: 'Last 7 Days',
  month: 'This Month',
  quarter: 'This Quarter',
  ytd: 'Year to Date',
  rolling_90: 'Rolling 90 Days',
  custom: 'Custom Range',
};

/** Anonymised benchmark bands (shown to inspectors) */
export interface BenchmarkBands {
  readonly metric_key: string;
  readonly top_25: number;
  readonly median: number;
  readonly bottom_25: number;
  readonly inspector_value: number | null;
  readonly band: 'top' | 'middle' | 'bottom';
}

// =============================================
// FEATURE 15: DEFECT LIBRARY
// =============================================

/** Source of a library entry */
export type LibraryEntrySource = 'system' | 'org';

/** Stable identity row — one per conceptual defect */
export interface DefectLibraryEntry {
  readonly id: string;
  readonly org_id: string | null;
  readonly source: LibraryEntrySource;
  readonly asset_type: string;
  readonly title: string;
  readonly system_key: string | null;
  readonly is_active: boolean;
  readonly sort_order: number;
  readonly usage_count: number;
  readonly created_at: string;
  readonly created_by_user_id: string | null;

  /** Latest version (joined for display convenience) */
  readonly current_version: DefectLibraryEntryVersion | null;
}

/** Immutable version snapshot */
export interface DefectLibraryEntryVersion {
  readonly id: string;
  readonly entry_id: string;
  readonly version: number;
  readonly description_template: string;
  readonly bs_en_refs: readonly string[];
  readonly severity_default: RiskRating;
  readonly remedial_action_template: string;
  readonly cost_band: CostBand | null;
  readonly timeframe_default: ActionTimeframe | null;
  readonly created_at: string;
  readonly created_by_user_id: string | null;
  readonly change_note: string | null;
}

/** What gets stored on an inspection defect when picked from library */
export interface LibraryDefectSnapshot {
  readonly library_entry_id: string;
  readonly library_entry_version_id: string;
  readonly was_edited: boolean;
  readonly edit_reason: string | null;
}

/** Flat view for the quick-pick bottom sheet */
export interface LibraryQuickPickItem {
  readonly entry_id: string;
  readonly version_id: string;
  readonly title: string;
  readonly description_template: string;
  readonly bs_en_refs: readonly string[];
  readonly severity_default: RiskRating;
  readonly remedial_action_template: string;
  readonly cost_band: CostBand | null;
  readonly timeframe_default: ActionTimeframe | null;
  readonly source: LibraryEntrySource;
  readonly usage_count: number;
}

/** Create/update payload for org custom entries */
export interface DefectLibraryEntryInput {
  readonly asset_type: string;
  readonly title: string;
  readonly system_key?: string;                   // for org override of system entry
  readonly description_template: string;
  readonly bs_en_refs: readonly string[];
  readonly severity_default: RiskRating;
  readonly remedial_action_template: string;
  readonly cost_band?: CostBand | null;
  readonly timeframe_default?: ActionTimeframe | null;
  readonly change_note?: string;
}

/** Protected field edit — requires reason */
export interface ProtectedFieldEdit {
  readonly field_name: 'bs_en_refs' | 'severity_default';
  readonly old_value: string;
  readonly new_value: string;
  readonly reason: string;
}

/** Audit record for protected field changes */
export interface DefectFieldAudit {
  readonly id: string;
  readonly org_id: string;
  readonly entity_type: 'inspection_defect' | 'library_entry';
  readonly entity_id: string;
  readonly field_name: string;
  readonly old_value: string | null;
  readonly new_value: string | null;
  readonly reason: string | null;
  readonly changed_by_user_id: string;
  readonly changed_at: string;
}

/** Version history response for library management UI */
export interface EntryVersionHistory {
  readonly entry: DefectLibraryEntry;
  readonly versions: readonly DefectLibraryEntryVersion[];
}

// =============================================
// API REQUEST/RESPONSE SHAPES
// =============================================

/** GET /api/v1/inspector-performance query params */
export interface PerformanceOverviewParams {
  readonly period?: PeriodPreset;
  readonly period_start?: string;
  readonly period_end?: string;
  readonly site_id?: string;
  readonly inspection_type?: InspectionType;
}

/** GET /api/v1/inspector-performance/:userId query params */
export interface PerformanceDetailParams {
  readonly period?: PeriodPreset;
  readonly period_start?: string;
  readonly period_end?: string;
}

/** GET /api/v1/defect-library query params */
export interface DefectLibraryQueryParams {
  readonly asset_type?: string;
  readonly source?: LibraryEntrySource;
  readonly search?: string;
  readonly is_active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/** GET /api/v1/defect-library/quick-pick/:assetType query params */
export interface QuickPickParams {
  readonly asset_type: string;
  readonly limit?: number;        // default 8
}
