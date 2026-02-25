-- =============================================
-- Migration 007: AI Style Normalisation
-- =============================================
-- Purpose: Audit trail for all AI text normalisation
--          and per-org monthly token usage tracking.
--
-- Tables:
--   normalisation_log   — immutable record of every suggestion + outcome
--   normalisation_usage — monthly token budget tracking per org
--
-- Org settings extension:
--   organisations.settings JSONB gains a "normalisation" key
--   (no schema change needed — JSONB is schema-flexible)
--
-- Run via: Neon SQL Editor
-- =============================================

BEGIN;

-- =============================================
-- TABLE: normalisation_log
-- =============================================

CREATE TABLE normalisation_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              TEXT        NOT NULL,
  inspection_id       UUID        REFERENCES inspections(id) ON DELETE SET NULL,
  inspection_item_id  UUID        REFERENCES inspection_items(id) ON DELETE SET NULL,
  defect_id           UUID        REFERENCES defects(id) ON DELETE SET NULL,

  -- What was normalised
  field_name          TEXT        NOT NULL,
  original_text       TEXT        NOT NULL,
  normalised_text     TEXT        NOT NULL,
  diff_summary        TEXT,

  -- Outcome
  status              TEXT        NOT NULL DEFAULT 'pending',
  rejected_reason     TEXT,

  -- AI metadata
  model_used          TEXT        NOT NULL,
  prompt_version      TEXT        NOT NULL DEFAULT 'v1',
  input_tokens        INTEGER     NOT NULL DEFAULT 0,
  output_tokens       INTEGER     NOT NULL DEFAULT 0,
  style_preset        TEXT,

  -- Who
  requested_by        TEXT        NOT NULL,
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Valid field names
  CONSTRAINT chk_normalisation_field CHECK (
    field_name IN (
      'defect_description',
      'remedial_action',
      'inspector_summary',
      'condition_observation'
    )
  ),

  -- Valid statuses
  CONSTRAINT chk_normalisation_status CHECK (
    status IN ('pending', 'accepted', 'rejected')
  )
);

-- Indexes
CREATE INDEX idx_normalisation_log_org
  ON normalisation_log (org_id);

CREATE INDEX idx_normalisation_log_org_status
  ON normalisation_log (org_id, status);

CREATE INDEX idx_normalisation_log_inspection
  ON normalisation_log (inspection_id)
  WHERE inspection_id IS NOT NULL;

CREATE INDEX idx_normalisation_log_defect
  ON normalisation_log (defect_id)
  WHERE defect_id IS NOT NULL;

CREATE INDEX idx_normalisation_log_created
  ON normalisation_log (created_at DESC);

CREATE INDEX idx_normalisation_log_requested_by
  ON normalisation_log (requested_by, created_at DESC);

-- RLS
ALTER TABLE normalisation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY normalisation_log_org_isolation
  ON normalisation_log
  USING (org_id = current_setting('app.current_org_id', true));


-- =============================================
-- TABLE: normalisation_usage
-- =============================================

CREATE TABLE normalisation_usage (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                TEXT        NOT NULL,
  month_year            TEXT        NOT NULL,
  input_tokens_total    BIGINT      NOT NULL DEFAULT 0,
  output_tokens_total   BIGINT      NOT NULL DEFAULT 0,
  request_count         INTEGER     NOT NULL DEFAULT 0,
  estimated_cost_usd    NUMERIC(10,4) NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per org per month
  CONSTRAINT uq_normalisation_usage
    UNIQUE (org_id, month_year)
);

-- Indexes
CREATE INDEX idx_normalisation_usage_org
  ON normalisation_usage (org_id);

-- RLS
ALTER TABLE normalisation_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY normalisation_usage_org_isolation
  ON normalisation_usage
  USING (org_id = current_setting('app.current_org_id', true));

COMMIT;

-- =============================================
-- ORGANISATION SETTINGS — normalisation config shape
-- =============================================
-- No schema change needed. The organisations.settings JSONB column
-- gains a "normalisation" key. Expected shape:
--
-- {
--   "normalisation": {
--     "enabled": true,
--     "style_preset": "formal",
--     "custom_guide": "Use third-person, avoid abbreviations...",
--     "examples": [
--       { "before": "chain's dodgy", "after": "Chain link integrity compromised" }
--     ],
--     "correct_spelling_grammar": true,
--     "require_review_before_export": true,
--     "monthly_token_budget": 500000,
--     "model_preference": "haiku"
--   }
-- }
--
-- Defaults (applied in code when key is absent):
--   enabled: false
--   style_preset: "formal"
--   correct_spelling_grammar: true
--   require_review_before_export: true
--   monthly_token_budget: 500000 (Haiku ~500k tokens ≈ $0.20/month)
--   model_preference: "haiku"
-- =============================================
