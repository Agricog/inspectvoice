/**
 * InspectVoice — Core Entity Types
 * Maps 1:1 to Neon PostgreSQL schema.
 * All IDs are UUID strings. All dates are ISO 8601 strings.
 */

import type {
  InspectionType,
  InspectionStatus,
  RiskRating,
  ConditionRating,
  ActionTimeframe,
  AIProcessingStatus,
  TranscriptionMethod,
  SiteType,
  SiteStatus,
  AssetCategory,
  AssetType,
  SurfaceType,
  ConditionTrend,
  DefectStatus,
  PhotoType,
  OrgTier,
  UserRole,
  CostBand,
} from './enums';

// =============================================
// BASE TYPES
// =============================================

/** All entities share these timestamp fields */
export interface Timestamps {
  readonly created_at: string;
  readonly updated_at: string;
}

/** Geo coordinates */
export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

// =============================================
// ORGANISATION
// =============================================

export interface Organisation extends Timestamps {
  readonly id: string;
  name: string;
  tier: OrgTier;
  max_users: number;
  max_sites: number | null;

  /** Branding for PDF reports */
  logo_url: string | null;
  primary_color: string;

  /** Org-level settings */
  settings: OrgSettings;

  /** Stripe billing */
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  trial_ends_at: string | null;
}

export interface OrgSettings {
  default_inspection_type: InspectionType;
  require_manager_approval: boolean;
  auto_export_on_sign: boolean;
}

// =============================================
// USER (synced from Clerk)
// =============================================

export interface User extends Timestamps {
  readonly id: string;
  org_id: string;

  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;

  /** Inspector credentials */
  rospa_certification_number: string | null;
  rpii_certification_number: string | null;
  other_qualifications: string[];

  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
}

/** Display name helper */
export function getUserDisplayName(user: User): string {
  if (user.first_name && user.last_name) {
    return `${user.first_name} ${user.last_name}`;
  }
  return user.first_name ?? user.email;
}

// =============================================
// SITE
// =============================================

export interface Site extends Timestamps {
  readonly id: string;
  org_id: string;

  /** Location */
  name: string;
  site_code: string | null;
  address: string;
  postcode: string | null;
  latitude: number;
  longitude: number;

  /** Classification */
  site_type: SiteType;

  /** Contact */
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;

  /** Access */
  access_notes: string | null;
  opening_hours: Record<string, string> | null;
  parking_notes: string | null;

  /** Compliance */
  install_date: string | null;
  last_refurbishment_date: string | null;
  inspection_frequency_routine_days: number;
  inspection_frequency_operational_days: number;
  inspection_frequency_annual_days: number;

  /** Financial */
  total_asset_value_gbp: number | null;
  maintenance_contract_ref: string | null;

  /** Status */
  status: SiteStatus;
  closure_reason: string | null;

  /** Metadata */
  notes: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
}

// =============================================
// ASSET
// =============================================

export interface Asset extends Timestamps {
  readonly id: string;
  site_id: string;

  /** Identification */
  asset_code: string;
  asset_type: AssetType;
  asset_category: AssetCategory;

  /** Manufacturer details */
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  purchase_cost_gbp: number | null;

  /** Compliance */
  compliance_standard: string | null;
  expected_lifespan_years: number | null;

  /** Playground-specific */
  surface_type: SurfaceType | null;
  fall_height_mm: number | null;
  impact_attenuation_required_mm: number | null;

  /** Maintenance */
  last_maintenance_date: string | null;
  next_maintenance_due: string | null;
  maintenance_notes: string | null;

  /** Reference photo (baseline condition) */
  reference_photo_id: string | null;

  /** Condition tracking (auto-calculated) */
  last_inspection_date: string | null;
  last_inspection_condition: ConditionRating | null;
  condition_trend: ConditionTrend | null;

  /** Status */
  is_active: boolean;
  decommissioned_date: string | null;
  decommission_reason: string | null;

  metadata: Record<string, unknown>;
}

// =============================================
// INSPECTION
// =============================================

export interface Inspection extends Timestamps {
  readonly id: string;
  org_id: string;
  site_id: string;
  inspector_id: string;

  /** Type (BS EN 1176-7) */
  inspection_type: InspectionType;

  /** Timing */
  inspection_date: string;
  started_at: string;
  completed_at: string | null;
  duration_minutes: number | null;

  /** Conditions */
  weather_conditions: string | null;
  temperature_c: number | null;
  surface_conditions: string | null;

  /** Status (state machine) */
  status: InspectionStatus;

  /** Risk summary (auto-calculated from items) */
  overall_risk_rating: RiskRating | null;
  very_high_risk_count: number;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  total_defects: number;

  /** Recommendations */
  closure_recommended: boolean;
  closure_reason: string | null;
  immediate_action_required: boolean;

  /** Signature (immutable once set) */
  signed_by: string | null;
  signed_at: string | null;
  signature_ip_address: string | null;

  /** Export */
  pdf_url: string | null;
  pdf_generated_at: string | null;

  /** Notes */
  inspector_summary: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
}

// =============================================
// INSPECTION ITEM (one per asset checked)
// =============================================

export interface InspectionItem {
  readonly id: string;
  inspection_id: string;
  asset_id: string | null;

  /** Asset identification */
  asset_code: string;
  asset_type: AssetType;

  /** Voice capture */
  audio_r2_key: string | null;
  voice_transcript: string | null;
  transcription_method: TranscriptionMethod | null;

  /** AI analysis */
  ai_analysis: AIAnalysisResult | null;
  ai_model_version: string;
  ai_processing_status: AIProcessingStatus;
  ai_processed_at: string | null;

  /** Structured defect data */
  defects: DefectDetail[];

  /** Overall assessment */
  overall_condition: ConditionRating | null;
  risk_rating: RiskRating | null;
  requires_action: boolean;
  action_timeframe: ActionTimeframe | null;

  /** Inspector review */
  inspector_confirmed: boolean;
  inspector_notes: string | null;
  inspector_risk_override: RiskRating | null;

  /** Location */
  latitude: number | null;
  longitude: number | null;

  /** Timing */
  timestamp: string;
  readonly created_at: string;
}

// =============================================
// AI ANALYSIS RESULT (Claude response)
// =============================================

export interface AIAnalysisResult {
  defects: DefectDetail[];
  overall_condition: ConditionRating;
  requires_immediate_action: boolean;
  closure_recommended: boolean;
  professional_summary: string;
}

export interface DefectDetail {
  description: string;
  bs_en_reference: string;
  risk_rating: RiskRating;
  remedial_action: string;
  action_timeframe: ActionTimeframe;
  estimated_cost_band: CostBand;
}

// =============================================
// PHOTO
// =============================================

export interface Photo {
  readonly id: string;
  inspection_item_id: string;

  /** Storage */
  r2_key: string;
  r2_url: string;
  thumbnail_r2_key: string | null;
  thumbnail_r2_url: string | null;

  /** File metadata */
  file_size_bytes: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;

  /** Location */
  latitude: number | null;
  longitude: number | null;

  /** Timing */
  captured_at: string;

  /** Classification */
  caption: string | null;
  is_primary: boolean;
  is_reference_photo: boolean;
  photo_type: PhotoType;

  metadata: Record<string, unknown>;
  readonly created_at: string;
}

// =============================================
// DEFECT (extracted for tracking)
// =============================================

export interface Defect extends Timestamps {
  readonly id: string;
  org_id: string;
  inspection_item_id: string;
  site_id: string;
  asset_id: string | null;

  /** Defect details */
  description: string;
  bs_en_reference: string | null;
  severity: RiskRating;
  remedial_action: string;
  action_timeframe: ActionTimeframe;

  /** Assignment */
  status: DefectStatus;
  assigned_to: string | null;
  assigned_at: string | null;

  /** Costs */
  estimated_cost_gbp: number | null;
  actual_cost_gbp: number | null;

  /** Timeline */
  due_date: string | null;
  started_at: string | null;
  resolved_at: string | null;
  verified_at: string | null;
  verified_by: string | null;

  /** Completion */
  resolution_notes: string | null;
  completion_photo_ids: string[];

  /** Deferral */
  deferral_reason: string | null;
  deferred_until: string | null;

  metadata: Record<string, unknown>;
}

// =============================================
// AUDIT LOG (read-only on frontend)
// =============================================

export interface AuditLogEntry {
  readonly id: string;
  org_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  readonly timestamp: string;
}
