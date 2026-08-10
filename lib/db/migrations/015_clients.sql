-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 015 — la fiche client
--
-- Il n'y en avait pas. Le nom du client était du texte libre, recopié
-- SÉPARÉMENT sur l'affaire, le devis, la facture et le prospect. « M. Dupont »
-- ne désignait donc aucune entité : rien ne pouvait se propager d'un objet à
-- l'autre, et deux orthographes du même nom donnaient deux clients.
--
-- ── PAS D'UNICITÉ SUR LE NOM ────────────────────────────────────────────────
-- Deux Dupont existent, et c'est le cas ordinaire dans une commune. Une
-- contrainte d'unicité forcerait l'artisan à inventer des suffixes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id          TEXT        PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  nom         TEXT        NOT NULL,
  type        TEXT        NOT NULL DEFAULT 'PARTICULIER'
                          CHECK (type IN ('PARTICULIER', 'PRO')),
  email       TEXT,
  telephone   TEXT,
  adresse     TEXT,
  code_postal TEXT,
  ville       TEXT,
  siret       TEXT,
  notes       TEXT,
  archive     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Liste courante : les non archivés d'un tenant.
CREATE INDEX IF NOT EXISTS clients_tenant_archive_idx ON clients (tenant_id, archive);

-- Recherche par nom. `lower()` et non un index trigramme : pg_trgm n'est pas
-- garanti activé, et le volume d'une TPE — quelques centaines de fiches — ne le
-- justifie pas. La normalisation des accents se fait côté application, avec la
-- fonction déjà écrite dans rapprochementCatalogue.ts.
CREATE INDEX IF NOT EXISTS clients_tenant_nom_idx ON clients (tenant_id, lower(nom));

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON clients;
CREATE POLICY tenant_isolation ON clients
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO app_user;
