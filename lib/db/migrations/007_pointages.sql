-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 007 — pointages (time tracking per member, affaire and day)
--
-- The missing source of truth: without it, margin per affaire is estimated
-- rather than measured, and `jours_factures_sur_payes` had no data at all
-- (see the stub it replaces in routes/analytics.ts).
--
-- `heures` is NUMERIC(5,2), not a float: hours are money once multiplied by a
-- charged cost, and binary floats do not add up exactly. 5 digits with 2
-- decimals allows up to 999.99 h on a single member/affaire/day line, which no
-- legal working day can exceed.
--
-- Uniqueness on (tenant_id, membre_id, affaire_id, date) makes the weekly
-- confirmation flow idempotent: re-confirming a week updates its lines instead
-- of duplicating them.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pointages (
  id          TEXT          PRIMARY KEY,
  tenant_id   UUID          NOT NULL REFERENCES tenants(id),
  membre_id   TEXT          NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  affaire_id  TEXT          NOT NULL REFERENCES affaires(id)     ON DELETE CASCADE,
  date        DATE          NOT NULL,
  heures      NUMERIC(5,2)  NOT NULL CHECK (heures > 0 AND heures <= 24),
  -- 'confirme' : validated from the pre-filled weekly recap (main path)
  -- 'saisi'    : typed by hand
  -- 'importe'  : brought in from an external source
  source      TEXT          NOT NULL DEFAULT 'confirme'
                            CHECK (source IN ('confirme', 'saisi', 'importe')),
  commentaire TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT pointages_unique_membre_affaire_jour
    UNIQUE (tenant_id, membre_id, affaire_id, date)
);

-- Tenant-scoped read patterns: by period (weekly recap, analytics) and by
-- affaire (margin computation).
CREATE INDEX IF NOT EXISTS pointages_tenant_date_idx    ON pointages (tenant_id, date);
CREATE INDEX IF NOT EXISTS pointages_tenant_affaire_idx ON pointages (tenant_id, affaire_id);
CREATE INDEX IF NOT EXISTS pointages_tenant_membre_idx  ON pointages (tenant_id, membre_id, date);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- ENABLE *and* FORCE — FORCE is what seals the table against the owner role too.
ALTER TABLE pointages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pointages FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON pointages;
CREATE POLICY tenant_isolation ON pointages
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON pointages TO app_user;
