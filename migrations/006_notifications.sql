-- =============================================
-- Migration 006: Notification Recipients & Log
-- =============================================
-- Purpose: Configurable summary email recipients per org/site
--          with audit log and idempotency dedup.
--
-- Tables:
--   notification_recipients — who receives what, at what frequency
--   notification_log        — immutable send log for audit + dedup
--
-- Run via: Neon SQL Editor
-- =============================================

BEGIN;

-- =============================================
-- TABLE: notification_recipients
-- =============================================

CREATE TABLE notification_recipients (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT        NOT NULL,
  site_id           UUID        REFERENCES sites(id) ON DELETE SET NULL,
  clerk_user_id     TEXT,
  external_email    TEXT,
  display_name      TEXT        NOT NULL,
  frequency         TEXT        NOT NULL DEFAULT 'weekly',
  notify_hotlist    BOOLEAN     NOT NULL DEFAULT true,
  notify_inspections BOOLEAN    NOT NULL DEFAULT true,
  notify_defects    BOOLEAN     NOT NULL DEFAULT true,
  notify_overdue    BOOLEAN     NOT NULL DEFAULT true,
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_by        TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Exactly one target: internal Clerk user OR external email
  CONSTRAINT chk_recipient_target CHECK (
    (clerk_user_id IS NOT NULL AND external_email IS NULL)
    OR
    (clerk_user_id IS NULL AND external_email IS NOT NULL)
  ),

  -- Valid frequency values
  CONSTRAINT chk_recipient_frequency CHECK (
    frequency IN ('daily', 'weekly', 'monthly')
  )
);

-- Indexes
CREATE INDEX idx_notification_recipients_org
  ON notification_recipients (org_id);

CREATE INDEX idx_notification_recipients_org_active
  ON notification_recipients (org_id, is_active)
  WHERE is_active = true;

CREATE INDEX idx_notification_recipients_frequency
  ON notification_recipients (frequency, is_active)
  WHERE is_active = true;

CREATE INDEX idx_notification_recipients_site
  ON notification_recipients (site_id)
  WHERE site_id IS NOT NULL;

-- RLS
ALTER TABLE notification_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_recipients_org_isolation
  ON notification_recipients
  USING (org_id = current_setting('app.current_org_id', true));

-- Updated_at trigger
CREATE TRIGGER set_notification_recipients_updated_at
  BEFORE UPDATE ON notification_recipients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- =============================================
-- TABLE: notification_log
-- =============================================

CREATE TABLE notification_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT        NOT NULL,
  recipient_id      UUID        NOT NULL REFERENCES notification_recipients(id) ON DELETE CASCADE,
  recipient_email   TEXT        NOT NULL,
  frequency         TEXT        NOT NULL,
  period_start      DATE        NOT NULL,
  period_end        DATE        NOT NULL,
  summary_data      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT        NOT NULL DEFAULT 'sent',
  error_message     TEXT,
  resend_message_id TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Valid status values
  CONSTRAINT chk_notification_log_status CHECK (
    status IN ('sent', 'failed', 'skipped')
  ),

  -- Idempotency: one email per recipient per period
  CONSTRAINT uq_notification_dedup
    UNIQUE (org_id, recipient_id, period_start, period_end)
);

-- Indexes
CREATE INDEX idx_notification_log_org
  ON notification_log (org_id);

CREATE INDEX idx_notification_log_sent_at
  ON notification_log (sent_at DESC);

CREATE INDEX idx_notification_log_status
  ON notification_log (status)
  WHERE status = 'failed';

CREATE INDEX idx_notification_log_recipient
  ON notification_log (recipient_id, sent_at DESC);

-- RLS
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_log_org_isolation
  ON notification_log
  USING (org_id = current_setting('app.current_org_id', true));

COMMIT;
