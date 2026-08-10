-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008 — catalogue_lignes (tarifs du tenant)
--
-- Le catalogue est la SEULE source de prix du devis dicté. Le modèle découpe
-- une dictée en intentions (libellé, quantité, unité) ; le prix, lui, ne vient
-- jamais de lui. Une intention sans correspondance dans cette table produit
-- une ligne SANS prix, marquée « à compléter » — voir CLAUDE.md §3.
--
-- `prix_unitaire_ht_cents` est un INTEGER de centimes : un prix est de
-- l'argent, jamais un flottant.
--
-- `mots_cles` est un text[] : les termes du métier sous lesquels l'artisan
-- désigne l'ouvrage à l'oral (« placo », « BA13 », « cloison »). Le
-- rapprochement est déterministe et lit cette colonne — il ne demande jamais
-- au modèle de choisir un prix.
--
-- Unicité sur (tenant_id, libelle) : un même libellé ne peut pas porter deux
-- prix, sinon le rapprochement devrait arbitrer et deviendrait non
-- déterministe.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalogue_lignes (
  id                      TEXT        PRIMARY KEY,
  tenant_id               UUID        NOT NULL REFERENCES tenants(id),
  libelle                 TEXT        NOT NULL,
  unite                   TEXT,
  prix_unitaire_ht_cents  INTEGER     NOT NULL CHECK (prix_unitaire_ht_cents >= 0),
  taux_tva                REAL        NOT NULL DEFAULT 20,
  mots_cles               TEXT[]      NOT NULL DEFAULT '{}',
  -- 'saisi'   : renseigné à la main
  -- 'reprise' : déduit des devis déjà émis (amorçage)
  origine                 TEXT        NOT NULL DEFAULT 'saisi'
                                      CHECK (origine IN ('saisi', 'reprise')),
  actif                   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalogue_lignes_unique_libelle UNIQUE (tenant_id, libelle)
);

CREATE INDEX IF NOT EXISTS catalogue_lignes_tenant_actif_idx
  ON catalogue_lignes (tenant_id, actif);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- ENABLE *et* FORCE : FORCE est ce qui scelle la table même pour le
-- propriétaire. Un catalogue de prix qui fuit entre tenants livrerait la
-- grille tarifaire d'un artisan à son concurrent.
ALTER TABLE catalogue_lignes ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_lignes FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON catalogue_lignes;
CREATE POLICY tenant_isolation ON catalogue_lignes
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON catalogue_lignes TO app_user;
