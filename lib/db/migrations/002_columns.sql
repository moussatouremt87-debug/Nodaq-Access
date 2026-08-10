-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — Column additions for legacy schema upgrade
--
-- MUST run before 002_rls.sql (sorts before it alphabetically: 'c' < 'r').
--
-- ── Why two files share the 002 prefix ───────────────────────────────────────
-- This is deliberate, not a numbering accident. migrate.mjs applies files in
-- ALPHABETICAL order and tracks each one in _migrations BY FILENAME — the
-- numeric prefix is a readable label, never a key. "002_columns.sql" sorting
-- before "002_rls.sql" is exactly the required dependency order: the columns
-- must exist before RLS policies referencing tenant_id are created.
--
-- DO NOT RENAME EITHER FILE. _migrations keys on the filename, so a rename
-- makes an already-applied migration look pending and replays it on every
-- existing database. 003_legacy_upgrade.sql is the scar from the last time
-- this happened — it is an intentional no-op kept solely to preserve the
-- _migrations record. See lib/db/README.md, "Numérotation des migrations".
-- On fresh installs (001 created the full schema): all statements are no-ops.
-- On databases that pre-date the migration system: adds the columns that were
-- originally introduced by the legacy CJS scripts (migrate-multitenant.cjs,
-- migrate-onboarding.cjs, migrate-facturation.cjs).
--
-- Idempotent: every statement uses ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── tenant_id on all business tables (from migrate-multitenant.cjs) ──────────
-- Added as nullable here so the ALTER does not fail for pre-existing rows.
-- IMPORTANT: this migration validates after adding the column that no rows
-- actually have a NULL tenant_id. If any are found, the migration aborts with
-- a clear message directing the operator to run the legacy backfill script first.
-- This ensures RLS (migration 002_rls.sql) can never be enabled on data that
-- would become inaccessible.

ALTER TABLE affaires          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE contrats          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE factures          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE prospects         ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE pending_actions   ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE chat_messages     ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE activity          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE devis             ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE classeur_documents ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE echeances         ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE team_members      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE connectors        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE settings          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE cr_entries        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE absences          ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- ── Tenant-ID integrity guard ─────────────────────────────────────────────────
-- Counts rows with NULL tenant_id across all business tables.
-- On a fresh install: all tables are empty → count is 0 → passes.
-- After a proper multitenant migration: all rows backfilled → count is 0 → passes.
-- On a pre-multitenant database with data and no backfill: count > 0 → ABORT.
--   Fix: run node lib/db/scripts/migrate-multitenant.cjs (backfills and enforces NOT NULL),
--   then re-run db:migrate.
DO $$
DECLARE
  null_count INTEGER := 0;
  tbl TEXT;
  row_count INTEGER;
  business_tables TEXT[] := ARRAY[
    'affaires','contrats','factures','prospects','pending_actions',
    'chat_messages','activity','devis','classeur_documents','echeances',
    'team_members','connectors','settings','cr_entries','absences'
  ];
BEGIN
  FOREACH tbl IN ARRAY business_tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id IS NULL', tbl)
      INTO row_count;
    null_count := null_count + row_count;
  END LOOP;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      E'tenant_id integrity check failed: % row(s) across business tables have NULL tenant_id.\n'
      'This database appears to predate the multi-tenant migration.\n'
      'Run the backfill script BEFORE db:migrate:\n'
      '  DATABASE_URL=<owner-url> node lib/db/scripts/migrate-multitenant.cjs\n'
      'Then re-run: DATABASE_URL=<owner-url> pnpm run db:migrate',
      null_count;
  END IF;
END $$;

-- ── team_members — from migrate-onboarding.cjs ───────────────────────────────
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS type_lien           TEXT NOT NULL DEFAULT 'SALARIE';
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS jours_par_semaine   REAL NOT NULL DEFAULT 5;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS cout_mensuel_charge REAL;

-- ── affaires — from migrate-onboarding.cjs ───────────────────────────────────
ALTER TABLE affaires ADD COLUMN IF NOT EXISTS montant_vendu_ht REAL;
ALTER TABLE affaires ADD COLUMN IF NOT EXISTS avancement_pct   REAL;
ALTER TABLE affaires ADD COLUMN IF NOT EXISTS date_fin_prevue  TEXT;
ALTER TABLE affaires ADD COLUMN IF NOT EXISTS origine          TEXT;

-- ── devis — from migrate-facturation.cjs ─────────────────────────────────────
ALTER TABLE devis ADD COLUMN IF NOT EXISTS client_address        JSONB;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS chantier_address      JSONB;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS autoliquidation       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS retenue_garantie_pct REAL    NOT NULL DEFAULT 0;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS accept_token          TEXT;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS accepted_at           TIMESTAMPTZ;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS accepted_by           TEXT;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS accepted_ip           TEXT;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS date_envoi            TIMESTAMPTZ;

-- ── factures — from migrate-facturation.cjs ──────────────────────────────────
ALTER TABLE factures ADD COLUMN IF NOT EXISTS statut                  TEXT    NOT NULL DEFAULT 'BROUILLON';
ALTER TABLE factures ADD COLUMN IF NOT EXISTS lines                   JSONB   NOT NULL DEFAULT '[]';
ALTER TABLE factures ADD COLUMN IF NOT EXISTS total_ht_cents          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS total_tva_cents         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS client_address          JSONB;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS chantier_address        JSONB;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS autoliquidation         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS attestation_tva_fournie BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS pdf_path                TEXT;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS pdf_sha256              TEXT;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS avoir_id                TEXT;

-- ── facture_sequences and avoirs — from migrate-facturation.cjs ──────────────
-- These tables are already covered by 001_initial_schema.sql (CREATE IF NOT EXISTS).
-- No ALTER TABLE needed here.

-- ── Enforce NOT NULL on tenant_id (all business tables) ──────────────────────
-- ALTER COLUMN ... SET NOT NULL is idempotent in PostgreSQL: it is a no-op
-- when the column is already NOT NULL (as on fresh installs via 001_initial_schema.sql
-- or after migrate-multitenant.cjs has run). The NULL-count validation above
-- guarantees no rows have NULL at this point, so SET NOT NULL is always safe.

ALTER TABLE affaires           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contrats           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE factures           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE prospects          ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE pending_actions    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE chat_messages      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE activity           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE devis              ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE classeur_documents ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE echeances          ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE team_members       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE connectors         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE settings           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE cr_entries         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE absences           ALTER COLUMN tenant_id SET NOT NULL;

-- ── Ensure FK constraint: tenant_id → tenants(id) on all business tables ─────
-- The ADD COLUMN above attaches the FK when creating a new column.
-- For tenant_id columns that pre-existed in very old schemas (added without a FK
-- reference), this DO block adds the constraint if absent.
-- Uses pg_constraint + pg_attribute to check idempotently.
DO $$
DECLARE
  tbl TEXT;
  business_tables TEXT[] := ARRAY[
    'affaires','contrats','factures','prospects','pending_actions',
    'chat_messages','activity','devis','classeur_documents','echeances',
    'team_members','connectors','settings','cr_entries','absences'
  ];
BEGIN
  FOREACH tbl IN ARRAY business_tables LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint  c
        JOIN pg_class       tc ON tc.oid = c.conrelid
        JOIN pg_class       rc ON rc.oid = c.confrelid
        JOIN pg_attribute   a  ON a.attrelid = tc.oid
                               AND a.attnum = ANY(c.conkey)
                               AND a.attname = 'tenant_id'
       WHERE c.contype = 'f'
         AND tc.relname  = tbl
         AND rc.relname  = 'tenants'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id)',
        tbl,
        tbl || '_tenant_id_fkey'
      );
      RAISE NOTICE 'Added FK: %.tenant_id → tenants.id', tbl;
    END IF;
  END LOOP;
END $$;

-- ── Ensure tenant_id indexes exist on all business tables ─────────────────────
-- 001_initial_schema.sql creates these with IF NOT EXISTS; they are re-stated
-- here so that legacy databases which skipped 001 (pre-migration systems) also
-- get the composite indexes needed for efficient tenant-scoped queries.
CREATE INDEX IF NOT EXISTS affaires_tenant_id_id_idx           ON affaires (tenant_id, id);
CREATE INDEX IF NOT EXISTS affaires_tenant_id_created_at_idx   ON affaires (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS contrats_tenant_id_id_idx           ON contrats (tenant_id, id);
CREATE INDEX IF NOT EXISTS contrats_tenant_id_created_at_idx   ON contrats (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS factures_tenant_id_id_idx           ON factures (tenant_id, id);
CREATE INDEX IF NOT EXISTS factures_tenant_id_created_at_idx   ON factures (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS prospects_tenant_id_id_idx          ON prospects (tenant_id, id);
CREATE INDEX IF NOT EXISTS prospects_tenant_id_created_at_idx  ON prospects (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS chat_messages_tenant_id_id_idx      ON chat_messages (tenant_id, id);
CREATE INDEX IF NOT EXISTS chat_messages_tenant_id_created_at_idx ON chat_messages (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS activity_tenant_id_id_idx           ON activity (tenant_id, id);
CREATE INDEX IF NOT EXISTS activity_tenant_id_created_at_idx   ON activity (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS echeances_tenant_id_id_idx          ON echeances (tenant_id, id);
CREATE INDEX IF NOT EXISTS echeances_tenant_id_created_at_idx  ON echeances (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS team_members_tenant_id_id_idx       ON team_members (tenant_id, id);
CREATE INDEX IF NOT EXISTS team_members_tenant_id_created_at_idx ON team_members (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS pending_actions_tenant_id_id_idx    ON pending_actions (tenant_id, id);
CREATE INDEX IF NOT EXISTS pending_actions_tenant_id_created_at_idx ON pending_actions (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS classeur_documents_tenant_id_id_idx ON classeur_documents (tenant_id, id);
CREATE INDEX IF NOT EXISTS classeur_documents_tenant_id_created_at_idx ON classeur_documents (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS devis_tenant_id_id_idx              ON devis (tenant_id, id);
CREATE INDEX IF NOT EXISTS devis_tenant_id_created_at_idx      ON devis (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS settings_tenant_id_idx              ON settings (tenant_id);
CREATE INDEX IF NOT EXISTS cr_entries_tenant_id_id_idx         ON cr_entries (tenant_id, id);
