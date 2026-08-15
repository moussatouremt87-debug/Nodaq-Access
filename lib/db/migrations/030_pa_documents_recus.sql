-- Migration 030 — documents reçus via une plateforme agréée (US-A2.6)
--
-- Réforme de facturation électronique : réception obligatoire pour tous les
-- tenants assujettis à la TVA dès le 1er septembre 2026. Cette table stocke
-- les factures Factur-X reçues des fournisseurs, immuables une fois captées
-- — même doctrine que archived_pdfs (006) : un document reçu ne se modifie
-- ni ne se supprime après coup, il se conserve tel quel.
--
-- `source` distingue une capture manuelle (dépôt par le tenant, en l'absence
-- de plateforme agréée contractée à ce jour) d'une capture automatisée via
-- l'API d'une PA une fois un contrat en place — voir lib/plateforme-agreee.
--
-- Table séparée des documents métier existants (comme archived_pdfs l'est de
-- factures/avoirs) : un SELECT * sur cette table ne doit jamais atterrir
-- dans une réponse de liste qui n'a pas besoin des octets.

CREATE TABLE IF NOT EXISTS pa_documents_recus (
  id                 TEXT        PRIMARY KEY,
  tenant_id          UUID        NOT NULL REFERENCES tenants(id),
  bytes              BYTEA       NOT NULL,
  sha256             TEXT        NOT NULL,
  byte_size          INTEGER     NOT NULL,
  source             TEXT        NOT NULL CHECK (source IN ('manuel', 'api')),
  fournisseur_siren  TEXT,
  montant_ttc_cents  INTEGER,
  date_facture       DATE,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pa_documents_recus_tenant
  ON pa_documents_recus (tenant_id, received_at);

ALTER TABLE pa_documents_recus ENABLE ROW LEVEL SECURITY;
ALTER TABLE pa_documents_recus FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON pa_documents_recus;
CREATE POLICY tenant_isolation ON pa_documents_recus
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

-- Immuabilité au niveau du moteur — même raisonnement que archived_pdfs (006) :
-- 002_rls.sql accorde SELECT/INSERT/UPDATE/DELETE par défaut à toute nouvelle
-- table, ce REVOKE est la seule défense durable. create-app-role.cjs réapplique
-- ce REVOKE à chaque exécution (APPEND_ONLY_TABLES) — ne pas retirer ce bloc
-- sans mettre à jour ce script en même temps.
REVOKE ALL ON pa_documents_recus FROM app_user;
GRANT SELECT, INSERT ON pa_documents_recus TO app_user;
