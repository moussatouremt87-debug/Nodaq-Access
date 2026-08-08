-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001 — Full initial schema (all tables, all columns, all indexes)
--
-- Idempotent: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- Run with DATABASE_URL (owner/superuser credentials).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Infrastructure tables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT        NOT NULL UNIQUE,
  password_hash  TEXT        NOT NULL,
  nom            TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS memberships (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'MEMBER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT memberships_user_tenant_unique UNIQUE (user_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Business tables (all tenant-scoped) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS affaires (
  id                   TEXT        PRIMARY KEY,
  tenant_id            UUID        NOT NULL REFERENCES tenants(id),
  reference            TEXT,
  label                TEXT        NOT NULL,
  client_name          TEXT,
  status               TEXT        NOT NULL DEFAULT 'PROSPECT',
  quoted_amount_cents  REAL,
  invoiced_amount_cents REAL,
  margin_cents         REAL,
  notes                TEXT,
  start_date           TEXT,
  completed_at         TEXT,
  montant_vendu_ht     REAL,
  avancement_pct       REAL,
  date_fin_prevue      TEXT,
  origine              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contrats (
  id                   TEXT        PRIMARY KEY,
  tenant_id            UUID        NOT NULL REFERENCES tenants(id),
  label                TEXT        NOT NULL,
  client_name          TEXT,
  cadence              TEXT        NOT NULL DEFAULT 'mensuel',
  amount_cents         REAL,
  status               TEXT        NOT NULL DEFAULT 'ACTIF',
  start_date           TEXT,
  end_date             TEXT,
  notes                TEXT,
  next_occurrence_date TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prospects (
  id                    TEXT        PRIMARY KEY,
  tenant_id             UUID        NOT NULL REFERENCES tenants(id),
  name                  TEXT        NOT NULL,
  company_name          TEXT,
  phone                 TEXT,
  email                 TEXT,
  stage                 TEXT        NOT NULL DEFAULT 'NOUVEAU',
  source                TEXT        NOT NULL DEFAULT 'AUTRE',
  estimated_value_cents REAL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  id                   TEXT        PRIMARY KEY,
  tenant_id            UUID        NOT NULL REFERENCES tenants(id),
  name                 TEXT        NOT NULL,
  role                 TEXT        NOT NULL DEFAULT 'Collaborateur',
  email                TEXT,
  availability         TEXT        NOT NULL DEFAULT 'DISPONIBLE',
  schedule             TEXT        NOT NULL DEFAULT '[]',
  type_lien            TEXT        NOT NULL DEFAULT 'SALARIE',
  jours_par_semaine    REAL        NOT NULL DEFAULT 5,
  cout_mensuel_charge  REAL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_actions (
  id            TEXT        PRIMARY KEY,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  type          TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'EN_ATTENTE',
  label         TEXT        NOT NULL,
  description   TEXT,
  affaire_id    TEXT,
  affaire_label TEXT,
  amount_cents  REAL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              TEXT        PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  conversation_id TEXT        NOT NULL,
  role            TEXT        NOT NULL,
  content         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity (
  id         TEXT        PRIMARY KEY,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id),
  type       TEXT        NOT NULL,
  label      TEXT        NOT NULL,
  meta       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devis (
  id                  TEXT        PRIMARY KEY,
  tenant_id           UUID        NOT NULL REFERENCES tenants(id),
  reference           TEXT        NOT NULL,
  client_name         TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'BROUILLON',
  lines               JSONB       NOT NULL DEFAULT '[]',
  total_ht_cents      INTEGER     NOT NULL DEFAULT 0,
  total_ttc_cents     INTEGER     NOT NULL DEFAULT 0,
  tva_rate            REAL        NOT NULL DEFAULT 20,
  remise              REAL        NOT NULL DEFAULT 0,
  notes               TEXT,
  valid_until         TEXT,
  affaire_id          TEXT,
  client_address      JSONB,
  chantier_address    JSONB,
  autoliquidation     BOOLEAN     NOT NULL DEFAULT FALSE,
  retenue_garantie_pct REAL       NOT NULL DEFAULT 0,
  accept_token        TEXT,
  accepted_at         TIMESTAMPTZ,
  accepted_by         TEXT,
  accepted_ip         TEXT,
  date_envoi          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classeur_documents (
  id          TEXT        PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  name        TEXT        NOT NULL,
  category    TEXT        NOT NULL DEFAULT 'DIVERS',
  size        REAL,
  mime_type   TEXT,
  notes       TEXT,
  affaire_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS echeances (
  id               TEXT        PRIMARY KEY,
  tenant_id        UUID        NOT NULL REFERENCES tenants(id),
  type             TEXT        NOT NULL,
  label            TEXT        NOT NULL,
  due_date         TEXT        NOT NULL,
  estimated_cents  REAL,
  paid_cents       REAL,
  status           TEXT        NOT NULL DEFAULT 'A_VENIR',
  notes            TEXT,
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connectors (
  id           TEXT        PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id),
  type         TEXT        NOT NULL,
  label        TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'NON_CONNECTE',
  config       JSONB       NOT NULL DEFAULT '{}',
  last_sync_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS connectors_tenant_type_uidx ON connectors (tenant_id, type);

CREATE TABLE IF NOT EXISTS settings (
  tenant_id  UUID        NOT NULL REFERENCES tenants(id),
  key        TEXT        NOT NULL,
  value      TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settings_tenant_key_pkey PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS cr_entries (
  id          TEXT        PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  period_key  TEXT        NOT NULL,
  line_code   TEXT        NOT NULL,
  amount_cents INTEGER    NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr_entries_tenant_period_line UNIQUE (tenant_id, period_key, line_code)
);

CREATE TABLE IF NOT EXISTS absences (
  id          TEXT        PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  membre_id   TEXT        NOT NULL REFERENCES team_members(id),
  type        TEXT        NOT NULL DEFAULT 'Congés',
  date_debut  DATE        NOT NULL,
  date_fin    DATE        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS absences_tenant_id_idx       ON absences (tenant_id);
CREATE INDEX IF NOT EXISTS absences_membre_date_fin_idx ON absences (membre_id, date_fin);

CREATE TABLE IF NOT EXISTS factures (
  id                     TEXT        PRIMARY KEY,
  tenant_id              UUID        NOT NULL REFERENCES tenants(id),
  -- Legacy columns (backward compat)
  customer_name          TEXT        NOT NULL,
  number                 TEXT        NOT NULL,
  issued_date            TEXT        NOT NULL,
  due_date               TEXT        NOT NULL,
  amount_cents           REAL        NOT NULL,
  residual_cents         REAL,
  settled                BOOLEAN     NOT NULL DEFAULT FALSE,
  affaire_id             TEXT,
  -- New columns
  statut                 TEXT        NOT NULL DEFAULT 'BROUILLON',
  lines                  JSONB       NOT NULL DEFAULT '[]',
  total_ht_cents         INTEGER     NOT NULL DEFAULT 0,
  total_tva_cents        INTEGER     NOT NULL DEFAULT 0,
  client_address         JSONB,
  chantier_address       JSONB,
  autoliquidation        BOOLEAN     NOT NULL DEFAULT FALSE,
  attestation_tva_fournie BOOLEAN    NOT NULL DEFAULT FALSE,
  pdf_path               TEXT,
  pdf_sha256             TEXT,
  avoir_id               TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facture_sequences (
  tenant_id  UUID     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year       INTEGER  NOT NULL,
  seq        INTEGER  NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);

CREATE TABLE IF NOT EXISTS avoirs (
  id                TEXT        PRIMARY KEY,
  tenant_id         UUID        NOT NULL REFERENCES tenants(id),
  numero            TEXT        NOT NULL,
  facture_ref_id    TEXT        NOT NULL,
  montant_ht_cents  INTEGER     NOT NULL,
  montant_tva_cents INTEGER     NOT NULL DEFAULT 0,
  motif             TEXT        NOT NULL,
  pdf_sha256        TEXT,
  pdf_path          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes on common query patterns ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS affaires_tenant_id_id_idx          ON affaires (tenant_id, id);
CREATE INDEX IF NOT EXISTS affaires_tenant_id_created_at_idx  ON affaires (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS contrats_tenant_id_id_idx          ON contrats (tenant_id, id);
CREATE INDEX IF NOT EXISTS contrats_tenant_id_created_at_idx  ON contrats (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS prospects_tenant_id_id_idx         ON prospects (tenant_id, id);
CREATE INDEX IF NOT EXISTS prospects_tenant_id_created_at_idx ON prospects (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS factures_tenant_id_id_idx          ON factures (tenant_id, id);
CREATE INDEX IF NOT EXISTS factures_tenant_id_created_at_idx  ON factures (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS chat_messages_tenant_id_id_idx     ON chat_messages (tenant_id, id);
CREATE INDEX IF NOT EXISTS chat_messages_tenant_id_created_at_idx ON chat_messages (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS activity_tenant_id_id_idx          ON activity (tenant_id, id);
CREATE INDEX IF NOT EXISTS activity_tenant_id_created_at_idx  ON activity (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS echeances_tenant_id_id_idx         ON echeances (tenant_id, id);
CREATE INDEX IF NOT EXISTS echeances_tenant_id_created_at_idx ON echeances (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS team_members_tenant_id_id_idx      ON team_members (tenant_id, id);
CREATE INDEX IF NOT EXISTS team_members_tenant_id_created_at_idx ON team_members (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS pending_actions_tenant_id_id_idx   ON pending_actions (tenant_id, id);
CREATE INDEX IF NOT EXISTS pending_actions_tenant_id_created_at_idx ON pending_actions (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS classeur_documents_tenant_id_id_idx   ON classeur_documents (tenant_id, id);
CREATE INDEX IF NOT EXISTS classeur_documents_tenant_id_created_at_idx ON classeur_documents (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS devis_tenant_id_id_idx             ON devis (tenant_id, id);
CREATE INDEX IF NOT EXISTS devis_tenant_id_created_at_idx     ON devis (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS settings_tenant_id_idx             ON settings (tenant_id);
CREATE INDEX IF NOT EXISTS cr_entries_tenant_id_id_idx        ON cr_entries (tenant_id, id);
