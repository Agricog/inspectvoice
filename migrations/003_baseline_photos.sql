-- Migration 003: Baseline Photos
-- Feature 5: Baseline vs current photo comparison
--
-- Adds baseline/reference photo tracking to assets for deterioration monitoring.
-- Councils require evidence of condition change over time (BS EN 1176-7 clause 8).
--
-- The baseline photo is set from the first inspection or manually by the inspector.
-- Subsequent inspections show side-by-side comparison in the capture UI and PDF report.

-- =============================================
-- BASELINE PHOTO COLUMNS ON ASSETS
-- =============================================

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS baseline_photo_url       TEXT,
  ADD COLUMN IF NOT EXISTS baseline_photo_r2_key    TEXT,
  ADD COLUMN IF NOT EXISTS baseline_photo_taken_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS baseline_photo_taken_by  TEXT,
  ADD COLUMN IF NOT EXISTS baseline_photo_inspection_id UUID REFERENCES inspections(id),
  ADD COLUMN IF NOT EXISTS baseline_condition        TEXT CHECK (baseline_condition IN ('good', 'fair', 'poor', 'dangerous'));

-- Index for quick lookup of assets with baselines
CREATE INDEX IF NOT EXISTS idx_assets_has_baseline
  ON assets (site_id)
  WHERE baseline_photo_url IS NOT NULL;

-- =============================================
-- BASELINE HISTORY TABLE
-- =============================================
-- Tracks every time a baseline is set or replaced (audit trail).

CREATE TABLE IF NOT EXISTS asset_baseline_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  asset_id          UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  photo_url         TEXT NOT NULL,
  photo_r2_key      TEXT,
  taken_at          TIMESTAMPTZ NOT NULL,
  taken_by          TEXT NOT NULL,
  condition_at_time TEXT CHECK (condition_at_time IN ('good', 'fair', 'poor', 'dangerous')),
  inspection_id     UUID REFERENCES inspections(id),
  replaced_at       TIMESTAMPTZ,
  replaced_by       TEXT,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS policy
ALTER TABLE asset_baseline_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY asset_baseline_history_org_isolation
  ON asset_baseline_history
  USING (org_id = current_setting('app.current_org_id')::uuid);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_baseline_history_asset
  ON asset_baseline_history (asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_baseline_history_org
  ON asset_baseline_history (org_id);

-- =============================================
-- PHOTO TYPE EXTENSION ON INSPECTION ITEMS
-- =============================================
-- Mark individual photos as 'baseline_candidate' so the UI can offer
-- "Set as Baseline" after capture.

-- This uses the existing pending_photos / photos table.
-- Add a flag column if the photos table exists:
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'photos') THEN
    ALTER TABLE photos
      ADD COLUMN IF NOT EXISTS is_baseline_candidate BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
