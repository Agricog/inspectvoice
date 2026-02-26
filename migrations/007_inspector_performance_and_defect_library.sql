-- =============================================
-- Migration 007: Inspector Performance & Defect Library
-- Features 14 + 15
-- =============================================

BEGIN;

-- ─────────────────────────────────────────────
-- FEATURE 14: Inspector Performance Metrics
-- ─────────────────────────────────────────────

-- Precomputed aggregates — avoids expensive real-time queries.
-- Cron job populates daily; manager dashboard reads from here.
CREATE TABLE IF NOT EXISTS inspector_metrics_period (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  inspector_user_id TEXT NOT NULL,

  -- Granularity
  period_type     TEXT NOT NULL CHECK (period_type IN ('day', 'week', 'month', 'quarter')),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,

  -- Optional filter dimension (null = all types combined)
  inspection_type TEXT CHECK (inspection_type IN (
    'routine_visual', 'operational', 'annual_main', 'post_repair', 'ad_hoc', NULL
  )),

  -- Core metrics
  inspections_completed       INT NOT NULL DEFAULT 0,
  completeness_avg            NUMERIC(5,2),            -- 0.00–100.00
  completeness_counts         JSONB DEFAULT '{}',      -- {"A":3,"B":5,"C":1,"D":0,"E":0,"F":0}
  defects_total               INT NOT NULL DEFAULT 0,
  defects_per_inspection_avg  NUMERIC(6,2),
  photo_compliance_pct        NUMERIC(5,2),            -- 0.00–100.00
  normalisation_accept_rate   NUMERIC(5,2),            -- 0.00–100.00
  avg_time_to_signoff_seconds INT,
  overdue_rate                NUMERIC(5,2),            -- 0.00–100.00
  makesafe_initiated_count    INT NOT NULL DEFAULT 0,
  makesafe_completed_count    INT NOT NULL DEFAULT 0,

  -- Extended metrics
  rework_rate                 NUMERIC(5,2),            -- % inspections returned for edits
  critical_response_avg_seconds INT,                   -- critical defect → make-safe started
  evidence_quality_pct        NUMERIC(5,2),            -- % defects with photo + notes
  completeness_variance       NUMERIC(6,2),            -- stddev of completeness scores
  audit_flag_count            INT NOT NULL DEFAULT 0,  -- BS EN edits + normalisation rejects

  -- Housekeeping
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  computed_by     TEXT NOT NULL DEFAULT 'cron' CHECK (computed_by IN ('cron', 'manual', 'api')),
  source_version  TEXT NOT NULL DEFAULT '1.0',

  -- Prevent duplicate periods
  CONSTRAINT uq_metrics_period UNIQUE (org_id, inspector_user_id, period_type, period_start, inspection_type)
);

CREATE INDEX idx_metrics_org_period ON inspector_metrics_period (org_id, period_type, period_start);
CREATE INDEX idx_metrics_inspector ON inspector_metrics_period (inspector_user_id, period_type, period_start);

-- "Your Month" shareable summary links
CREATE TABLE IF NOT EXISTS performance_share_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              TEXT NOT NULL,
  inspector_user_id   TEXT NOT NULL,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  token_hash          TEXT NOT NULL UNIQUE,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_by_user_id  TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_share_links_token ON performance_share_links (token_hash);

-- ─────────────────────────────────────────────
-- FEATURE 15: Defect & Recommendation Library
-- ─────────────────────────────────────────────

-- Stable identity — one row per conceptual defect entry.
CREATE TABLE IF NOT EXISTS defect_library_entry (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              TEXT,                          -- NULL for system entries
  source              TEXT NOT NULL CHECK (source IN ('system', 'org')),
  asset_type          TEXT NOT NULL,                 -- matches AssetType enum
  title               TEXT NOT NULL,                 -- short display label
  system_key          TEXT,                          -- for org overrides of system entries
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order          INT NOT NULL DEFAULT 0,        -- display ordering
  usage_count         INT NOT NULL DEFAULT 0,        -- popularity tracking
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id  TEXT,

  -- Org entries require org_id
  CONSTRAINT chk_org_source CHECK (
    (source = 'system' AND org_id IS NULL) OR
    (source = 'org' AND org_id IS NOT NULL)
  )
);

CREATE INDEX idx_library_asset_type ON defect_library_entry (asset_type, is_active);
CREATE INDEX idx_library_org ON defect_library_entry (org_id, is_active) WHERE org_id IS NOT NULL;
CREATE INDEX idx_library_system_key ON defect_library_entry (system_key) WHERE system_key IS NOT NULL;

-- Immutable version snapshots — never mutated, only new rows appended.
CREATE TABLE IF NOT EXISTS defect_library_entry_version (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id                UUID NOT NULL REFERENCES defect_library_entry(id) ON DELETE CASCADE,
  version                 INT NOT NULL DEFAULT 1,
  description_template    TEXT NOT NULL,
  bs_en_refs              TEXT[] NOT NULL DEFAULT '{}',
  severity_default        TEXT NOT NULL CHECK (severity_default IN ('very_high', 'high', 'medium', 'low')),
  remedial_action_template TEXT NOT NULL,
  cost_band               TEXT CHECK (cost_band IN ('low', 'medium', 'high')),
  timeframe_default       TEXT CHECK (timeframe_default IN (
    'immediate', '48_hours', '1_week', '1_month', 'next_inspection', 'routine'
  )),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id      TEXT,
  change_note             TEXT,

  CONSTRAINT uq_entry_version UNIQUE (entry_id, version)
);

CREATE INDEX idx_version_entry ON defect_library_entry_version (entry_id, version DESC);

-- Audit log for protected field edits (BS EN refs, severity changes)
CREATE TABLE IF NOT EXISTS defect_field_audit (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              TEXT NOT NULL,
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('inspection_defect', 'library_entry')),
  entity_id           TEXT NOT NULL,
  field_name          TEXT NOT NULL,
  old_value           TEXT,
  new_value           TEXT,
  reason              TEXT,
  changed_by_user_id  TEXT NOT NULL,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_field_audit_entity ON defect_field_audit (entity_type, entity_id);
CREATE INDEX idx_field_audit_org ON defect_field_audit (org_id, changed_at DESC);

COMMIT;
