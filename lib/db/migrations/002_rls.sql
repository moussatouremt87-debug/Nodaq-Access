-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — app_user role, grants, and Row-Level Security
--
-- Run with DATABASE_URL (owner/superuser credentials).
--
-- MUST run after 002_columns.sql, which adds the tenant_id columns the policies
-- below reference. The shared 002 prefix is deliberate: migrate.mjs applies
-- files alphabetically, and 'c' < 'r' gives exactly that order. Neither file may
-- be renamed — _migrations keys on the filename. See 002_columns.sql for the
-- full explanation.
--
-- IMPORTANT: This migration creates app_user with a PLACEHOLDER password
-- ('REPLACE_ME_run_create-app-role.cjs') if the role does not already exist —
-- a value that is public, since it sits in this repository.
--
-- On the normal path (`pnpm db:setup`) this never happens: create-app-role.cjs
-- runs FIRST and creates the role with a generated password, so the block below
-- takes its ELSE branch and only enforces attributes.
--
-- But if migrations are applied on their own (`pnpm db:migrate` on a fresh
-- database), this migration creates the role with that placeholder. Running
-- create-app-role.cjs WITHOUT a flag will then PRESERVE it — the script cannot
-- read a password back from PostgreSQL, so it cannot tell a placeholder from a
-- real secret. Rotate explicitly in that case:
--
--   node lib/db/scripts/create-app-role.cjs --rotate-password
-- ─────────────────────────────────────────────────────────────────────────────

-- ── app_user role ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE $q$
      CREATE ROLE app_user
        LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
        PASSWORD 'REPLACE_ME_run_create-app-role.cjs'
    $q$;
    RAISE NOTICE
      'app_user role created with placeholder password. '
      'Run lib/db/scripts/create-app-role.cjs to rotate to a strong password.';
  ELSE
    -- Enforce minimum privilege attributes on existing role
    ALTER ROLE app_user NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    RAISE NOTICE 'app_user role already exists — privilege attributes verified.';
  END IF;
END $$;

-- ── Schema usage ─────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO app_user;

-- ── Table and sequence grants ─────────────────────────────────────────────────
-- Infrastructure tables (read-only for app_user where applicable)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, users, memberships, sessions
  TO app_user;

-- Business tables
GRANT SELECT, INSERT, UPDATE, DELETE ON
  affaires, contrats, prospects, team_members, pending_actions,
  chat_messages, activity, devis, classeur_documents, echeances,
  connectors, settings, cr_entries, absences,
  factures, facture_sequences, avoirs
  TO app_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Default privileges: automatically grant access to future tables/sequences
-- created by the owner during subsequent migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Enable RLS on all business tables.
-- Infrastructure tables (tenants, users, memberships, sessions) are NOT RLS-protected;
-- they are access-controlled by the application middleware.

DO $$
DECLARE
  tbl TEXT;
  business_tables TEXT[] := ARRAY[
    'affaires', 'contrats', 'factures', 'prospects',
    'pending_actions', 'chat_messages', 'activity', 'devis',
    'classeur_documents', 'echeances', 'team_members',
    'connectors', 'settings', 'cr_entries', 'absences',
    'facture_sequences', 'avoirs'
  ];
BEGIN
  FOREACH tbl IN ARRAY business_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

    -- Drop + recreate is idempotent and keeps the policy definition current.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING  (tenant_id::text = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true))
    $p$, tbl);

    RAISE NOTICE 'RLS applied: %', tbl;
  END LOOP;
END $$;

-- ── Narrow public-token policy on devis ──────────────────────────────────────
-- Allows app_user to SELECT a single devis row when the session GUC
-- app.devis_accept_token matches the row's accept_token column.
-- This enables the unauthenticated acceptance flow without bypassing RLS.

DROP POLICY IF EXISTS devis_public_token_lookup ON devis;

CREATE POLICY devis_public_token_lookup ON devis
  FOR SELECT TO app_user
  USING (
    accept_token IS NOT NULL
    AND accept_token = current_setting('app.devis_accept_token', true)
  );
