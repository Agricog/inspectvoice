/**
 * InspectVoice — Normalisation Types
 * Types for AI style normalisation feature.
 * Maps to backend normalise.ts service + routes.
 */

// =============================================
// FIELD TYPES
// =============================================

export type NormalisableField =
  | 'defect_description'
  | 'remedial_action'
  | 'inspector_summary'
  | 'condition_observation';

export const NORMALISABLE_FIELD_LABELS: Record<NormalisableField, string> = {
  defect_description: 'Defect Description',
  remedial_action: 'Remedial Action',
  inspector_summary: 'Inspector Summary',
  condition_observation: 'Condition Observation',
};

// =============================================
// STYLE CONFIG (matches org settings JSONB)
// =============================================

export type StylePreset = 'formal' | 'technical' | 'plain_english';

export const STYLE_PRESET_LABELS: Record<StylePreset, string> = {
  formal: 'Formal',
  technical: 'Technical',
  plain_english: 'Plain English',
};

export const STYLE_PRESET_DESCRIPTIONS: Record<StylePreset, string> = {
  formal: 'Third-person, professional language for council reports',
  technical: 'Engineering-grade terminology with material and failure mode detail',
  plain_english: 'Clear, jargon-free language for non-technical audiences',
};

export type ModelPreference = 'haiku' | 'sonnet';

export const MODEL_PREFERENCE_LABELS: Record<ModelPreference, string> = {
  haiku: 'Haiku (Fast, Low Cost)',
  sonnet: 'Sonnet (Higher Quality, ~10× Cost)',
};

export interface StyleExample {
  before: string;
  after: string;
}

export interface NormalisationSettings {
  enabled: boolean;
  style_preset: StylePreset;
  custom_guide: string | null;
  examples: StyleExample[];
  correct_spelling_grammar: boolean;
  require_review_before_export: boolean;
  monthly_token_budget: number;
  model_preference: ModelPreference;
}

export const DEFAULT_NORMALISATION_SETTINGS: NormalisationSettings = {
  enabled: false,
  style_preset: 'formal',
  custom_guide: null,
  examples: [],
  correct_spelling_grammar: true,
  require_review_before_export: true,
  monthly_token_budget: 500_000,
  model_preference: 'haiku',
};

// =============================================
// API REQUEST / RESPONSE
// =============================================

export interface NormaliseFieldRequest {
  field_name: NormalisableField;
  original_text: string;
  inspection_id?: string;
  inspection_item_id?: string;
  defect_id?: string;
  asset_type?: string;
}

export interface NormaliseResult {
  logId: string;
  fieldName: NormalisableField;
  originalText: string;
  normalisedText: string;
  diffSummary: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  noChangesNeeded: boolean;
}

export interface BatchNormaliseResult {
  results: NormaliseResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
  budgetRemaining: number;
}

export interface NormalisationLogEntry {
  id: string;
  org_id: string;
  inspection_id: string | null;
  inspection_item_id: string | null;
  defect_id: string | null;
  field_name: NormalisableField;
  original_text: string;
  normalised_text: string;
  diff_summary: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  rejected_reason: string | null;
  model_used: string;
  prompt_version: string;
  input_tokens: number;
  output_tokens: number;
  style_preset: string | null;
  requested_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface NormalisationUsageResponse {
  monthly_budget: number;
  current_month: string;
  current_tokens_used: number;
  budget_remaining: number;
  budget_percentage_used: number;
  history: Array<{
    month_year: string;
    input_tokens_total: number;
    output_tokens_total: number;
    request_count: number;
    estimated_cost_usd: string;
  }>;
}
