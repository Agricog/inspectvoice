-- =============================================
-- InspectVoice — Migration 002: Make Safe Actions
-- Records on-site make-safe actions taken by inspectors
-- for high-risk defects before leaving the site.
--
-- Tender requirement: "high-risk defects reported before
-- leaving site, with a photo and make-safe recommendation"
--
-- Run via: psql $DATABASE_URL -f 002_make_safe_actions.sql
-- =============================================

-- =============================================
-- 1. MAKE SAFE ACTIONS TABLE
-- =============================================

CREATE TABLE make_safe_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id         UUID NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  org_id            TEXT NOT NULL REFERENCES organisations(org_id),
  site_id           UUID NOT NULL REFERENCES sites(id),
  asset_id          UUID REFERENCES assets(id),

  -- Who performed the action
  performed_by      TEXT NOT NULL REFERENCES users(id),

  -- What was done
  action_taken      TEXT NOT NULL
                    CHECK (action_taken IN (
                      'barrier_tape',
                      'signage_placed',
                      'asset_closed',
                      'area_cordoned',
                      'asset_removed',
                      'temporary_repair',
                      'verbal_warning_given',
                      'other'
                    )),
  action_details    TEXT NOT NULL,          -- Free text: what exactly was done
  recommendation    TEXT NOT NULL,          -- What should happen next

  -- Evidence
  photo_r2_key      TEXT,                   -- R2 key for make-safe evidence photo
  photo_r2_url      TEXT,                   -- Signed URL (regenerated on access)

  -- Location + time
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Whether the asset was taken out of service
  asset_closed      BOOLEAN NOT NULL DEFAULT false,

  -- Notification tracking
  manager_notified        BOOLEAN NOT NULL DEFAULT false,
  manager_notified_at     TIMESTAMPTZ,
  notification_method     TEXT CHECK (notification_method IS NULL OR
                          notification_method IN ('in_app', 'email', 'sms', 'phone')),

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_make_safe_defect ON make_safe_actions (defect_id);
CREATE INDEX idx_make_safe_org ON make_safe_actions (org_id);
CREATE INDEX idx_make_safe_site ON make_safe_actions (site_id);
CREATE INDEX idx_make_safe_performer ON make_safe_actions (performed_by);
CREATE INDEX idx_make_safe_recent ON make_safe_actions (org_id, performed_at DESC);

-- RLS
ALTER TABLE make_safe_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY make_safe_tenant_isolation ON make_safe_actions
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- Updated_at trigger
CREATE TRIGGER trg_make_safe_updated_at
  BEFORE UPDATE ON make_safe_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- 2. ADD make_safe FLAG TO DEFECTS TABLE
-- =============================================
-- Quick lookup: was this defect made safe on-site?

ALTER TABLE defects
  ADD COLUMN IF NOT EXISTS made_safe       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS made_safe_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS made_safe_by    TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS asset_closed    BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_defects_made_safe ON defects (org_id, made_safe)
  WHERE made_safe = true;

-- =============================================
-- 3. AUTO-UPDATE DEFECT ON MAKE-SAFE INSERT
-- =============================================
-- When a make-safe action is recorded, flag the parent defect.

CREATE OR REPLACE FUNCTION auto_flag_defect_made_safe()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE defects SET
    made_safe    = true,
    made_safe_at = NEW.performed_at,
    made_safe_by = NEW.performed_by,
    asset_closed = NEW.asset_closed,
    updated_at   = NOW()
  WHERE id = NEW.defect_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_make_safe_flag_defect
  AFTER INSERT ON make_safe_actions
  FOR EACH ROW EXECUTE FUNCTION auto_flag_defect_made_safe();

-- =============================================
-- MIGRATION COMPLETE
-- =============================================
-- New table: make_safe_actions
-- New columns on defects: made_safe, made_safe_at, made_safe_by, asset_closed
-- New trigger: auto-flag defect when make-safe action recorded
-- =============================================
