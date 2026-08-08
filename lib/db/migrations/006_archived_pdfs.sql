-- Migration 006 — archivage des PDF en base
--
-- Remplace le stockage disque (STORAGE_DIR), incompatible avec un conteneur :
-- le disque est éphémère et non partagé entre instances.
--
-- Table séparée volontairement : les requêtes de factures.ts / avoirs.ts font
-- SELECT * ; une colonne bytea sur `factures` renverrait tous les PDF dans la
-- réponse de la route liste.

CREATE TABLE IF NOT EXISTS archived_pdfs (
  id             TEXT        PRIMARY KEY,
  tenant_id      UUID        NOT NULL REFERENCES tenants(id),
  document_type  TEXT        NOT NULL CHECK (document_type IN ('FACTURE', 'AVOIR')),
  document_id    TEXT        NOT NULL,
  bytes          BYTEA       NOT NULL,
  sha256         TEXT        NOT NULL,
  byte_size      INTEGER     NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT archived_pdfs_unique_document
    UNIQUE (tenant_id, document_type, document_id)
);

CREATE INDEX IF NOT EXISTS archived_pdfs_tenant_document
  ON archived_pdfs (tenant_id, document_type, document_id);

ALTER TABLE archived_pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE archived_pdfs FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON archived_pdfs;
CREATE POLICY tenant_isolation ON archived_pdfs
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

-- Immuabilité au niveau du moteur.
-- ATTENTION : 002_rls.sql pose un ALTER DEFAULT PRIVILEGES qui accorde
-- SELECT, INSERT, UPDATE, DELETE sur toute nouvelle table. Sans ce REVOKE,
-- l'archive resterait modifiable par l'application.
REVOKE ALL ON archived_pdfs FROM app_user;
GRANT SELECT, INSERT ON archived_pdfs TO app_user;
