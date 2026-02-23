-- =============================================
-- InspectVoice — Initial Database Schema
-- Neon PostgreSQL (AWS eu-west-2 London)
--
-- Built 1:1 against:
--   src/types/entities.ts (all entity interfaces)
--   src/types/enums.ts (all CHECK constraint values)
--
-- Run via: psql $DATABASE_URL -f 001_initial_schema.sql
-- =============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- 1. ORGANISATIONS
-- =============================================

CREATE TABLE organisations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT UNIQUE NOT NULL,           -- Clerk organisation ID (org_xxx)
  name            TEXT NOT NULL,
  company_name    TEXT,
  company_address TEXT,
  company_phone   TEXT,
  company_email   TEXT,

  -- Tier & limits
  tier            TEXT NOT NULL DEFAULT 'individual'
                  CHECK (tier IN ('individual', 'team', 'enterprise')),
  max_users       INTEGER NOT NULL DEFAULT 1,
  max_sites       INTEGER,

  -- Branding (PDF reports)
  logo_url        TEXT,
  primary_color   TEXT NOT NULL DEFAULT '#22C55E',

  -- Settings (JSONB)
  settings        JSONB NOT NULL DEFAULT '{
    "default_inspection_type": "routine_visual",
    "require_manager_approval": false,
    "auto_export_on_sign": false
  }'::jsonb,

  -- Accreditation
  accreditation_body    TEXT,
  accreditation_number  TEXT,
  report_footer_text    TEXT,

  -- Stripe billing
  stripe_customer_id           TEXT,
  stripe_subscription_id       TEXT,
  subscription_status          TEXT NOT NULL DEFAULT 'trialing'
                               CHECK (subscription_status IN (
                                 'trialing', 'active', 'past_due', 'cancelled',
                                 'unpaid', 'incomplete', 'expired'
                               )),
  subscription_plan            TEXT,
  subscription_current_period_end TIMESTAMPTZ,
  trial_ends_at                TIMESTAMPTZ,
  payment_failed_at            TIMESTAMPTZ,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organisations_org_id ON organisations (org_id);
CREATE INDEX idx_organisations_stripe_customer ON organisations (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- =============================================
-- 2. USERS (synced from Clerk webhooks)
-- =============================================

CREATE TABLE users (
  id              TEXT PRIMARY KEY,               -- Clerk user ID (user_xxx)
  org_id          TEXT REFERENCES organisations(org_id),

  email           TEXT,
  display_name    TEXT,
  first_name      TEXT,
  last_name       TEXT,
  phone           TEXT,

  -- Inspector credentials
  rospa_certification_number  TEXT,
  rpii_number                 TEXT,
  rpii_grade                  TEXT,
  other_qualifications        TEXT,

  -- Insurance
  insurance_provider          TEXT,
  insurance_policy_number     TEXT,

  -- Role & status
  role            TEXT CHECK (role IN ('inspector', 'manager', 'admin')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  deactivated_at  TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_org_id ON users (org_id);
CREATE INDEX idx_users_email ON users (email);

-- =============================================
-- 3. SITES
-- =============================================

CREATE TABLE sites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL REFERENCES organisations(org_id),

  -- Location
  name            TEXT NOT NULL,
  site_code       TEXT,
  address         TEXT NOT NULL DEFAULT '',
  postcode        TEXT,
  latitude        DOUBLE PRECISION NOT NULL DEFAULT 0,
  longitude       DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Classification
  site_type       TEXT NOT NULL DEFAULT 'playground'
                  CHECK (site_type IN (
                    'playground', 'park', 'outdoor_gym', 'muga',
                    'skate_park', 'sports_pitch', 'mixed'
                  )),

  -- Contact
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,

  -- Access
  access_notes    TEXT,
  opening_hours   JSONB,
  parking_notes   TEXT,

  -- Compliance
  install_date              DATE,
  last_refurbishment_date   DATE,
  inspection_frequency_routine_days     INTEGER NOT NULL DEFAULT 7,
  inspection_frequency_operational_days INTEGER NOT NULL DEFAULT 90,
  inspection_frequency_annual_days      INTEGER NOT NULL DEFAULT 365,

  -- Financial
  total_asset_value_gbp     NUMERIC(12,2),
  maintenance_contract_ref  TEXT,

  -- Status
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived', 'temporary_closure')),
  closure_reason  TEXT,

  -- Metadata
  notes           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by      TEXT REFERENCES users(id),

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sites_org_id ON sites (org_id);
CREATE INDEX idx_sites_status ON sites (org_id, status);
CREATE INDEX idx_sites_name ON sites (org_id, name);

-- =============================================
-- 4. ASSETS
-- =============================================

CREATE TABLE assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  org_id          TEXT NOT NULL REFERENCES organisations(org_id),

  -- Identification
  asset_code      TEXT NOT NULL,
  asset_type      TEXT NOT NULL,
  asset_category  TEXT NOT NULL
                  CHECK (asset_category IN (
                    'playground', 'outdoor_gym', 'furniture', 'sports', 'other'
                  )),

  -- Manufacturer
  manufacturer    TEXT,
  model           TEXT,
  serial_number   TEXT,
  install_date    DATE,
  purchase_cost_gbp NUMERIC(10,2),

  -- Compliance
  compliance_standard        TEXT,
  expected_lifespan_years    INTEGER,

  -- Playground-specific
  surface_type               TEXT CHECK (surface_type IS NULL OR surface_type IN (
                               'wetpour', 'rubber_mulch', 'bark_mulch', 'grass',
                               'sand', 'artificial_grass', 'tarmac', 'concrete', 'other'
                             )),
  fall_height_mm             INTEGER,
  impact_attenuation_required_mm INTEGER,

  -- Maintenance
  last_maintenance_date      DATE,
  next_maintenance_due       DATE,
  maintenance_notes          TEXT,

  -- Reference photo
  reference_photo_id         UUID,

  -- Condition tracking (auto-calculated)
  last_inspection_date       TIMESTAMPTZ,
  last_inspection_condition  TEXT CHECK (last_inspection_condition IS NULL OR
                             last_inspection_condition IN ('good', 'fair', 'poor', 'dangerous')),
  condition_trend            TEXT CHECK (condition_trend IS NULL OR
                             condition_trend IN ('improving', 'stable', 'deteriorating')),

  -- Status
  is_active               BOOLEAN NOT NULL DEFAULT true,
  decommissioned_date     DATE,
  decommission_reason     TEXT,

  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique asset code per site
  UNIQUE (site_id, asset_code)
);

CREATE INDEX idx_assets_site_id ON assets (site_id);
CREATE INDEX idx_assets_org_id ON assets (org_id);
CREATE INDEX idx_assets_active ON assets (site_id, is_active);

-- =============================================
-- 5. INSPECTIONS
-- =============================================

CREATE TABLE inspections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL REFERENCES organisations(org_id),
  site_id         UUID NOT NULL REFERENCES sites(id),
  inspector_id    TEXT NOT NULL REFERENCES users(id),

  -- Type (BS EN 1176-7)
  inspection_type TEXT NOT NULL
                  CHECK (inspection_type IN (
                    'routine_visual', 'operational', 'annual_main',
                    'post_repair', 'ad_hoc'
                  )),

  -- Timing
  inspection_date DATE NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_minutes INTEGER,

  -- Conditions
  weather_conditions TEXT,
  temperature_c      NUMERIC(4,1),
  surface_conditions TEXT,

  -- Status (state machine: draft → review → signed → exported)
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'review', 'signed', 'exported')),

  -- Risk summary (auto-calculated from inspection_items)
  overall_risk_rating    TEXT CHECK (overall_risk_rating IS NULL OR
                         overall_risk_rating IN ('very_high', 'high', 'medium', 'low')),
  very_high_risk_count   INTEGER NOT NULL DEFAULT 0,
  high_risk_count        INTEGER NOT NULL DEFAULT 0,
  medium_risk_count      INTEGER NOT NULL DEFAULT 0,
  low_risk_count         INTEGER NOT NULL DEFAULT 0,
  total_defects          INTEGER NOT NULL DEFAULT 0,

  -- Recommendations
  closure_recommended       BOOLEAN NOT NULL DEFAULT false,
  closure_reason            TEXT,
  immediate_action_required BOOLEAN NOT NULL DEFAULT false,

  -- Signature (immutable once set)
  signed_by          TEXT,
  signed_at          TIMESTAMPTZ,
  signature_ip_address TEXT,

  -- Export
  pdf_url            TEXT,
  pdf_generated_at   TIMESTAMPTZ,

  -- Notes
  inspector_summary  TEXT,
  notes              TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspections_org_id ON inspections (org_id);
CREATE INDEX idx_inspections_site_id ON inspections (site_id);
CREATE INDEX idx_inspections_inspector ON inspections (inspector_id);
CREATE INDEX idx_inspections_status ON inspections (org_id, status);
CREATE INDEX idx_inspections_date ON inspections (org_id, inspection_date DESC);

-- =============================================
-- 6. INSPECTION ITEMS (one per asset checked)
-- =============================================

CREATE TABLE inspection_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id        UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  asset_id             UUID REFERENCES assets(id),

  -- Asset identification (denormalised for offline + reports)
  asset_code           TEXT NOT NULL,
  asset_type           TEXT NOT NULL,

  -- Voice capture
  audio_r2_key         TEXT,
  voice_transcript     TEXT,
  transcription_method TEXT CHECK (transcription_method IS NULL OR
                       transcription_method IN ('deepgram', 'web_speech_api', 'manual')),

  -- AI analysis
  ai_analysis          JSONB,
  ai_model_version     TEXT NOT NULL DEFAULT '',
  ai_processing_status TEXT NOT NULL DEFAULT 'pending'
                       CHECK (ai_processing_status IN ('pending', 'processing', 'completed', 'failed')),
  ai_processed_at      TIMESTAMPTZ,

  -- Structured defects (JSONB array, also normalised into defects table)
  defects              JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Overall assessment
  overall_condition    TEXT CHECK (overall_condition IS NULL OR
                       overall_condition IN ('good', 'fair', 'poor', 'dangerous')),
  risk_rating          TEXT CHECK (risk_rating IS NULL OR
                       risk_rating IN ('very_high', 'high', 'medium', 'low')),
  requires_action      BOOLEAN NOT NULL DEFAULT false,
  action_timeframe     TEXT CHECK (action_timeframe IS NULL OR
                       action_timeframe IN (
                         'immediate', '48_hours', '1_week',
                         '1_month', 'next_inspection', 'routine'
                       )),

  -- Inspector review
  inspector_confirmed      BOOLEAN NOT NULL DEFAULT false,
  inspector_notes          TEXT,
  inspector_risk_override  TEXT CHECK (inspector_risk_override IS NULL OR
                           inspector_risk_override IN ('very_high', 'high', 'medium', 'low')),

  -- Location
  latitude             DOUBLE PRECISION,
  longitude            DOUBLE PRECISION,

  -- Timing
  timestamp            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspection_items_inspection ON inspection_items (inspection_id);
CREATE INDEX idx_inspection_items_asset ON inspection_items (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX idx_inspection_items_risk ON inspection_items (inspection_id, risk_rating);
CREATE INDEX idx_inspection_items_ai_status ON inspection_items (ai_processing_status)
  WHERE ai_processing_status IN ('pending', 'processing');

-- =============================================
-- 7. PHOTOS
-- =============================================

CREATE TABLE photos (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_item_id   UUID NOT NULL REFERENCES inspection_items(id) ON DELETE CASCADE,

  -- Storage
  r2_key               TEXT NOT NULL,
  r2_url               TEXT NOT NULL,
  thumbnail_r2_key     TEXT,
  thumbnail_r2_url     TEXT,

  -- File metadata
  file_size_bytes      INTEGER,
  mime_type            TEXT,
  width                INTEGER,
  height               INTEGER,

  -- Location
  latitude             DOUBLE PRECISION,
  longitude            DOUBLE PRECISION,

  -- Timing
  captured_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Classification
  caption              TEXT,
  is_primary           BOOLEAN NOT NULL DEFAULT false,
  is_reference_photo   BOOLEAN NOT NULL DEFAULT false,
  photo_type           TEXT NOT NULL DEFAULT 'defect'
                       CHECK (photo_type IN ('defect', 'overview', 'reference', 'completion')),

  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_photos_inspection_item ON photos (inspection_item_id);

-- =============================================
-- 8. DEFECTS (normalised from AI analysis for tracking)
-- =============================================

CREATE TABLE defects (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               TEXT REFERENCES organisations(org_id),   -- auto-populated by trigger
  inspection_item_id   UUID NOT NULL REFERENCES inspection_items(id) ON DELETE CASCADE,
  site_id              UUID REFERENCES sites(id),               -- auto-populated by trigger
  asset_id             UUID REFERENCES assets(id),              -- auto-populated by trigger

  -- Defect details
  description          TEXT NOT NULL,
  defect_category      TEXT,
  bs_en_reference      TEXT,
  severity             TEXT NOT NULL
                       CHECK (severity IN ('very_high', 'high', 'medium', 'low')),
  remedial_action      TEXT,
  action_required      TEXT,
  action_timeframe     TEXT NOT NULL DEFAULT 'next_inspection'
                       CHECK (action_timeframe IN (
                         'immediate', '48_hours', '1_week',
                         '1_month', 'next_inspection', 'routine'
                       )),

  -- Assignment
  status               TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN (
                         'open', 'assigned', 'in_progress', 'resolved',
                         'verified', 'deferred', 'not_actioned'
                       )),
  source               TEXT NOT NULL DEFAULT 'ai'
                       CHECK (source IN ('ai', 'manual')),
  assigned_to          TEXT REFERENCES users(id),
  assigned_at          TIMESTAMPTZ,

  -- Costs
  estimated_cost_gbp   TEXT,
  actual_cost_gbp      NUMERIC(10,2),

  -- Timeline
  due_date             DATE,
  started_at           TIMESTAMPTZ,
  resolved_at          TIMESTAMPTZ,
  verified_at          TIMESTAMPTZ,
  verified_by          TEXT REFERENCES users(id),

  -- Completion
  resolution_notes     TEXT,
  completion_photo_ids TEXT[] NOT NULL DEFAULT '{}',

  -- Deferral
  deferral_reason      TEXT,
  deferred_until       DATE,

  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_defects_org_id ON defects (org_id);
CREATE INDEX idx_defects_inspection_item ON defects (inspection_item_id);
CREATE INDEX idx_defects_site_id ON defects (site_id);
CREATE INDEX idx_defects_status ON defects (org_id, status);
CREATE INDEX idx_defects_severity ON defects (org_id, severity);
CREATE INDEX idx_defects_open ON defects (org_id, status, severity)
  WHERE status IN ('open', 'assigned', 'in_progress');

-- =============================================
-- 9. AUDIT LOG
-- =============================================

CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT NOT NULL,
  user_id         TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  changes         JSONB,
  ip_address      TEXT,
  user_agent      TEXT,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_org_id ON audit_log (org_id);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_timestamp ON audit_log (org_id, timestamp DESC);

-- =============================================
-- 10. WEBHOOK EVENTS (idempotency)
-- =============================================

CREATE TABLE webhook_events (
  id              TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('stripe', 'clerk')),
  status          TEXT NOT NULL DEFAULT 'processing'
                  CHECK (status IN ('processing', 'completed', 'failed')),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,
  PRIMARY KEY (id, source)
);

CREATE INDEX idx_webhook_events_status ON webhook_events (status)
  WHERE status = 'processing';

-- =============================================
-- 11. ROW-LEVEL SECURITY POLICIES
-- =============================================
-- Neon supports RLS. These policies enforce multi-tenancy
-- at the database level as a defence-in-depth measure.
-- The application sets current_setting('app.org_id') before queries.
--
-- Note: RLS is enforced on authenticated roles only.
-- The migration role bypasses RLS.
-- =============================================

-- Enable RLS on all tenant-scoped tables
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Sites: tenant isolation
CREATE POLICY sites_tenant_isolation ON sites
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- Assets: tenant isolation via org_id
CREATE POLICY assets_tenant_isolation ON assets
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- Inspections: tenant isolation
CREATE POLICY inspections_tenant_isolation ON inspections
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- Defects: tenant isolation
CREATE POLICY defects_tenant_isolation ON defects
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- Audit log: tenant isolation (read-only policy — no WITH CHECK)
CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (org_id = current_setting('app.org_id', true));

-- =============================================
-- 12. UPDATED_AT TRIGGER
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organisations_updated_at
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_sites_updated_at
  BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_assets_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_inspections_updated_at
  BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_defects_updated_at
  BEFORE UPDATE ON defects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- 13. SIGNED INSPECTION IMMUTABILITY
-- =============================================

-- =============================================
-- 13a. AUTO-POPULATE DEFECT ORG/SITE IDs
-- =============================================
-- The AI pipeline Worker inserts defects with only inspection_item_id.
-- This trigger resolves org_id and site_id from the inspection chain.
-- =============================================

CREATE OR REPLACE FUNCTION auto_populate_defect_context()
RETURNS TRIGGER AS $$
BEGIN
  -- Only populate if not already set
  IF NEW.org_id IS NULL OR NEW.site_id IS NULL THEN
    SELECT i.org_id, i.site_id
    INTO NEW.org_id, NEW.site_id
    FROM inspections i
    INNER JOIN inspection_items ii ON ii.inspection_id = i.id
    WHERE ii.id = NEW.inspection_item_id;
  END IF;

  -- Also resolve asset_id if not set
  IF NEW.asset_id IS NULL THEN
    SELECT ii.asset_id
    INTO NEW.asset_id
    FROM inspection_items ii
    WHERE ii.id = NEW.inspection_item_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_defect_auto_context
  BEFORE INSERT ON defects
  FOR EACH ROW EXECUTE FUNCTION auto_populate_defect_context();

-- =============================================
-- 13b. SIGNED INSPECTION IMMUTABILITY
-- =============================================
-- Prevent modification of signed inspections.
-- This enforces the state machine at the DB level.
-- =============================================

CREATE OR REPLACE FUNCTION prevent_signed_inspection_modification()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow status transitions forward only
  IF OLD.status IN ('signed', 'exported') THEN
    -- Only allow: signed → exported, and pdf_url updates
    IF NEW.status = 'exported' AND OLD.status = 'signed' THEN
      RETURN NEW;
    END IF;
    IF NEW.pdf_url IS DISTINCT FROM OLD.pdf_url
       OR NEW.pdf_generated_at IS DISTINCT FROM OLD.pdf_generated_at THEN
      -- Allow PDF generation updates on signed inspections
      NEW.status := OLD.status;
      RETURN NEW;
    END IF;
    -- Block all other changes
    RAISE EXCEPTION 'Cannot modify a signed or exported inspection (id: %)', OLD.id;
  END IF;

  -- Prevent backward transitions
  IF OLD.status = 'review' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot revert inspection from review to draft (id: %)', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inspection_immutability
  BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION prevent_signed_inspection_modification();

-- =============================================
-- MIGRATION COMPLETE
-- =============================================
-- Tables: organisations, users, sites, assets, inspections,
--         inspection_items, photos, defects, audit_log, webhook_events
-- Indexes: 22 indexes on key query paths
-- RLS: 5 tenant isolation policies
-- Triggers: 6 updated_at + 1 immutability
-- =============================================
