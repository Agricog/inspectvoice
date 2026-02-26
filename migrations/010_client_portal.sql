-- ============================================================================
-- Migration 010: Client Portal
-- ============================================================================
-- Creates 7 tables for the client-facing portal:
--   1. client_workspaces        — Client tenant (council/site owner)
--   2. client_workspace_providers — Link table: client ↔ inspection company
--   3. client_users             — Client user accounts (Clerk-backed)
--   4. client_site_access       — Granular site-level permissions for clients
--   5. client_defect_updates    — Client assertions on defects (not authoritative)
--   6. client_magic_links       — Token-hash-based one-off resource access
--   7. client_notifications     — Notification records for client users
--
-- Design principles:
--   • Separate auth boundary — client workspace IDs are independent of org IDs
--   • Cross-org ready — client_workspace_providers supports many-to-many (V1 ships 1:1)
--   • Least privilege — clients submit assertions, inspectors verify and close
--   • Magic links store token_hash only (SHA-256), never plaintext tokens
--   • Full audit trail on all client actions (who, when, what, actor type)
--   • RLS policies for defense-in-depth tenant isolation
--
-- Depends on: Migration 001 (core schema — sites, defects, organisations)
-- ============================================================================

-- ─────────────────────────────────────────────
-- 1. client_workspaces
-- ─────────────────────────────────────────────
-- The top-level client tenant. Each commissioning body (e.g. a council parks
-- department) gets one workspace. Linked to their own Clerk org for auth.

CREATE TABLE IF NOT EXISTS client_workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id    TEXT NOT NULL,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  branding        JSONB NOT NULL DEFAULT '{}',
  settings        JSONB NOT NULL DEFAULT '{"powered_by_visible": true}',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT client_workspaces_clerk_org_id_unique UNIQUE (clerk_org_id),
  CONSTRAINT client_workspaces_slug_unique UNIQUE (slug),
  CONSTRAINT client_workspaces_status_check CHECK (
    status IN ('active', 'suspended', 'archived')
  ),
  CONSTRAINT client_workspaces_name_not_empty CHECK (char_length(TRIM(name)) > 0),
  CONSTRAINT client_workspaces_slug_not_empty CHECK (char_length(TRIM(slug)) > 0),
  CONSTRAINT client_workspaces_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$')
);

CREATE INDEX idx_client_workspaces_status ON client_workspaces (status);
CREATE INDEX idx_client_workspaces_slug ON client_workspaces (slug);

CREATE TRIGGER trg_client_workspaces_updated_at
  BEFORE UPDATE ON client_workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: Portal guard sets app.client_workspace_id session var
ALTER TABLE client_workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_workspaces_isolation ON client_workspaces
  USING (id::TEXT = current_setting('app.client_workspace_id', TRUE));


-- ─────────────────────────────────────────────
-- 2. client_workspace_providers
-- ─────────────────────────────────────────────
-- Links a client workspace to one or more inspection company orgs.
-- V1 ships as 1:1 but schema supports many-to-many from day one.

CREATE TABLE IF NOT EXISTS client_workspace_providers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_workspace_id   UUID NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  org_id                TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active',
  linked_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linked_by             TEXT NOT NULL,

  CONSTRAINT cwp_workspace_org_unique UNIQUE (client_workspace_id, org_id),
  CONSTRAINT cwp_status_check CHECK (status IN ('active', 'revoked')),
  CONSTRAINT cwp_org_id_not_empty CHECK (char_length(TRIM(org_id)) > 0),
  CONSTRAINT cwp_linked_by_not_empty CHECK (char_length(TRIM(linked_by)) > 0)
);

CREATE INDEX idx_cwp_org_id ON client_workspace_providers (org_id);
CREATE INDEX idx_cwp_workspace_id ON client_workspace_providers (client_workspace_id);
CREATE INDEX idx_cwp_status ON client_workspace_providers (status) WHERE status = 'active';

-- RLS: Inspector-side queries filter by org_id; portal-side by client_workspace_id
ALTER TABLE client_workspace_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY cwp_isolation_by_workspace ON client_workspace_providers
  USING (client_workspace_id::TEXT = current_setting('app.client_workspace_id', TRUE));

CREATE POLICY cwp_isolation_by_org ON client_workspace_providers
  USING (org_id = current_setting('app.org_id', TRUE));


-- ─────────────────────────────────────────────
-- 3. client_users
-- ─────────────────────────────────────────────
-- Client-side user accounts. Each maps to a Clerk user in the client's
-- Clerk application (separate from the inspector Clerk app).

CREATE TABLE IF NOT EXISTS client_users (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id             TEXT NOT NULL,
  client_workspace_id       UUID NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  role                      TEXT NOT NULL DEFAULT 'viewer',
  name                      TEXT NOT NULL,
  email                     TEXT NOT NULL,
  job_title                 TEXT,
  notification_preferences  JSONB NOT NULL DEFAULT '{"report_published": true, "critical_defect": true, "defect_status_changed": false, "remedial_complete": true, "comment_mention": true}',
  site_subscriptions        TEXT[] NOT NULL DEFAULT '{}',
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  invited_by                TEXT,
  invited_at                TIMESTAMPTZ,
  last_login_at             TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT client_users_clerk_workspace_unique UNIQUE (clerk_user_id, client_workspace_id),
  CONSTRAINT client_users_role_check CHECK (role IN ('viewer', 'contributor', 'admin')),
  CONSTRAINT client_users_name_not_empty CHECK (char_length(TRIM(name)) > 0),
  CONSTRAINT client_users_email_not_empty CHECK (char_length(TRIM(email)) > 0)
);

CREATE INDEX idx_client_users_workspace_id ON client_users (client_workspace_id);
CREATE INDEX idx_client_users_clerk_user_id ON client_users (clerk_user_id);
CREATE INDEX idx_client_users_active ON client_users (client_workspace_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_client_users_email ON client_users (client_workspace_id, email);

CREATE TRIGGER trg_client_users_updated_at
  BEFORE UPDATE ON client_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE client_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_users_isolation ON client_users
  USING (client_workspace_id::TEXT = current_setting('app.client_workspace_id', TRUE));


-- ─────────────────────────────────────────────
-- 4. client_site_access
-- ─────────────────────────────────────────────
-- Granular site-level permissions. A client workspace only sees sites
-- explicitly granted to it by the inspection company.

CREATE TABLE IF NOT EXISTS client_site_access (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_workspace_id   UUID NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  site_id               UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  access_level          TEXT NOT NULL DEFAULT 'full',
  granted_by            TEXT NOT NULL,
  granted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT csa_workspace_site_unique UNIQUE (client_workspace_id, site_id),
  CONSTRAINT csa_access_level_check CHECK (access_level IN ('full', 'restricted')),
  CONSTRAINT csa_granted_by_not_empty CHECK (char_length(TRIM(granted_by)) > 0)
);

CREATE INDEX idx_csa_workspace_id ON client_site_access (client_workspace_id);
CREATE INDEX idx_csa_site_id ON client_site_access (site_id);

ALTER TABLE client_site_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY csa_isolation ON client_site_access
  USING (client_workspace_id::TEXT = current_setting('app.client_workspace_id', TRUE));


-- ─────────────────────────────────────────────
-- 5. client_defect_updates
-- ─────────────────────────────────────────────
-- Client assertions on defects. These are NOT authoritative status changes.
-- Only inspectors/managers can change the canonical defect status.
-- Clients may: acknowledge, comment, report work complete, etc.

CREATE TABLE IF NOT EXISTS client_defect_updates (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_workspace_id     UUID NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  defect_id               UUID NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  client_user_id          UUID NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  update_type             TEXT NOT NULL,
  comment                 TEXT,
  attachments             JSONB NOT NULL DEFAULT '[]',
  proposed_status         TEXT,
  inspector_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  inspector_verified_by   TEXT,
  inspector_verified_at   TIMESTAMPTZ,
  inspector_notes         TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cdu_update_type_check CHECK (
    update_type IN ('acknowledged', 'comment', 'work_complete', 'contractor_booked', 'unable_to_action')
  ),
  CONSTRAINT cdu_proposed_status_check CHECK (
    proposed_status IS NULL OR proposed_status IN (
      'work_complete_client_reported', 'contractor_booked', 'unable_to_action'
    )
  ),
  -- If work_complete, must have a comment explaining what was done
  CONSTRAINT cdu_work_complete_needs_comment CHECK (
    update_type != 'work_complete' OR (comment IS NOT NULL AND char_length(TRIM(comment)) > 0)
  )
);

CREATE INDEX idx_cdu_workspace_id ON client_defect_updates (client_workspace_id);
CREATE INDEX idx_cdu_defect_id ON client_defect_updates (defect_id);
CREATE INDEX idx_cdu_client_user_id ON client_defect_updates (client_user_id);
CREATE INDEX idx_cdu_unverified ON client_defect_updates (inspector_verified, created_at)
  WHERE inspector_verified = FALSE;
CREATE INDEX idx_cdu_update_type ON client_defect_updates (client_workspace_id, update_type);

ALTER TABLE client_defect_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY cdu_isolation ON client_defect_updates
  USING (client_workspace_id::TEXT = current_setting('app.client_workspace_id', TRUE));


-- ─────────────────────────────────────────────
-- 6. client_magic_links
-- ─────────────────────────────────────────────
-- One-off resource access tokens for PDF downloads, defect exports, etc.
-- NEVER stores plaintext tokens — only SHA-256 hash.
-- Token shown once at creation time, then irrecoverable.
-- Access metadata logged for audit (timestamp, IP hash, user-agent).

CREATE TABLE IF NOT EXISTS client_magic_links (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_workspace_id         UUID NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  resource_type               TEXT NOT NULL,
  resource_id                 UUID NOT NULL,
  token_hash                  TEXT NOT NULL,
  created_by                  TEXT NOT NULL,
  expires_at                  TIMESTAMPTZ NOT NULL,
  max_uses                    INTEGER NOT NULL DEFAULT 5,
  use_count                   INTEGER NOT NULL DEFAULT 0,
  first_accessed_at           TIMESTAMPTZ,
  last_accessed_at            TIMESTAMPTZ,
  last_accessed_ip_hash       TEXT,
  last_accessed_user_agent    TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cml_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT cml_resource_type_check CHECK (
    resource_type IN ('inspection_pdf', 'defect_export', 'sealed_bundle')
  ),
  CONSTRAINT cml_max_uses_positive CHECK (max_uses > 0),
  CONSTRAINT cml_use_count_non_negative CHECK (use_count >= 0),
  CONSTRAINT cml_use_count_within_max CHECK (use_count <= max_uses),
  CONSTRAINT cml_created_by_not_empty CHECK (char_length(TRIM(created_by)) > 0),
  CONSTRAINT cml_expires_future CHECK (expires_at > created_at)
);

CREATE INDEX idx_cml_token_hash ON client_magic_links (token_hash);
CREATE INDEX idx_cml_workspace_id ON client_magic_links (client_workspace_id);
CREATE INDEX idx_cml_resource ON client_magic_links (resource_type, resource_id);
CREATE INDEX idx_cml_active ON client_magic_links (expires_at)
  WHERE use_count < max_uses;

ALTER TABLE client_magic_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY cml_isolation ON client_magic_links
  USING (client_workspace_id::TEXT = current_setting('app.client_workspace_id', TRUE));


-- ─────────────────────────────────────────────
-- 7. client_notifications
-- ─────────────────────────────────────────────
-- Notification records for client users. Generated by triggers/events
-- on the inspector side (report published, defect changed, etc.).

CREATE TABLE IF NOT EXISTS client_notifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_workspace_id   UUID NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  client_user_id        UUID NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  notification_type     TEXT NOT NULL,
  site_id               UUID,
  title                 TEXT NOT NULL,
  body                  TEXT NOT NULL,
  link_url              TEXT,
  is_read               BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cn_notification_type_check CHECK (
    notification_type IN (
      'report_published',
      'critical_defect',
      'defect_status_changed',
      'remedial_complete',
      'comment_mention'
    )
  ),
  CONSTRAINT cn_title_not_empty CHECK (char_length(TRIM(title)) > 0),
  CONSTRAINT cn_body_not_empty CHECK (char_length(TRIM(body)) > 0)
);

CREATE INDEX idx_cn_workspace_user ON client_notifications (client_workspace_id, client_user_id);
CREATE INDEX idx_cn_unread ON client_notifications (client_user_id, is_read, created_at)
  WHERE is_read = FALSE;
CREATE INDEX idx_cn_site_id ON client_notifications (site_id) WHERE site_id IS NOT NULL;
CREATE INDEX idx_cn_type ON client_notifications (client_workspace_id, notification_type);
CREATE INDEX idx_cn_created_at ON client_notifications (client_workspace_id, created_at DESC);

ALTER TABLE client_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY cn_isolation ON client_notifications
  USING (client_workspace_id::TEXT = current_setting('app.client_workspace_id', TRUE));


-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Tables created: 7
--   client_workspaces              — 2 indexes, 1 RLS policy, 1 trigger
--   client_workspace_providers     — 3 indexes, 2 RLS policies (workspace + org)
--   client_users                   — 4 indexes, 1 RLS policy, 1 trigger
--   client_site_access             — 2 indexes, 1 RLS policy
--   client_defect_updates          — 5 indexes, 1 RLS policy
--   client_magic_links             — 4 indexes, 1 RLS policy
--   client_notifications           — 5 indexes, 1 RLS policy
--
-- Total: 25 indexes, 8 RLS policies, 2 triggers, 17 check constraints
-- ============================================================================
