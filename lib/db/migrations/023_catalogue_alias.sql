-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 023 — alias appris du catalogue
--
-- `rapprocher()` accepte un dictionnaire d'alias depuis le lot 2 (PR A). Il
-- n'a jamais été rempli : personne ne lui en fournissait. C'est ce que cette
-- table apporte.
--
-- ── CE QU'UN ALIAS EST, ET N'EST PAS ────────────────────────────────────────
-- Un alias est une CORRECTION HUMAINE : l'artisan a dicté « du placo », le
-- produit n'a rien trouvé, il a désigné lui-même la ligne « Cloison BA13 ».
-- On retient l'association pour ne plus lui reposer la question.
--
-- Ce n'est PAS une déduction. Rien n'est appris d'un rapprochement automatique,
-- ni d'une ligne que l'artisan a laissée telle quelle : seule une désignation
-- explicite fait foi. Apprendre de ses propres suppositions ferait dériver le
-- catalogue sans que personne ne s'en aperçoive.
--
-- ── UNE PHRASE, UNE LIGNE ───────────────────────────────────────────────────
-- Unicité sur `(tenant_id, alias_normalise)`. Le même mot ne peut pas désigner
-- deux ouvrages : ce serait rétablir exactement l'ambiguïté que `rapprocher`
-- refuse de trancher, mais en la cachant derrière un alias.
--
-- ── PAS APPEND-ONLY ─────────────────────────────────────────────────────────
-- Contrairement à `contact_bases` ou `paiements`, un alias se corrige et se
-- retire. Une erreur d'apprentissage qu'on ne pourrait pas défaire mettrait un
-- mauvais prix sur tous les devis suivants — l'inverse du service rendu.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalogue_alias (
  id                  TEXT        PRIMARY KEY,
  tenant_id           UUID        NOT NULL REFERENCES tenants(id),
  -- Le libellé dicté, NORMALISÉ par la même fonction que le rapprochement.
  -- Normaliser côté application et non en SQL : deux normalisations finiraient
  -- par diverger, et « Génin » cesserait de rencontrer « GENIN » un jour sur
  -- deux.
  alias_normalise     TEXT        NOT NULL,
  -- Ce que l'artisan a réellement dit, tel quel. Sert à lui montrer ce qu'il a
  -- appris : « du placo » est lisible, « du placo » normalisé ne l'est plus.
  libelle_dicte       TEXT        NOT NULL,
  catalogue_ligne_id  TEXT        NOT NULL REFERENCES catalogue_lignes(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Une phrase ne désigne qu'un ouvrage.
  CONSTRAINT catalogue_alias_unique UNIQUE (tenant_id, alias_normalise)
);

-- La suppression d'une ligne de catalogue emporte ses alias : `rapprocher`
-- sait ignorer un alias orphelin, mais le garder ferait croire à l'artisan
-- qu'il a appris quelque chose d'encore utile.
CREATE INDEX IF NOT EXISTS catalogue_alias_tenant_idx
  ON catalogue_alias (tenant_id, alias_normalise);
CREATE INDEX IF NOT EXISTS catalogue_alias_ligne_idx
  ON catalogue_alias (tenant_id, catalogue_ligne_id);

ALTER TABLE catalogue_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_alias FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON catalogue_alias;
CREATE POLICY tenant_isolation ON catalogue_alias
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON catalogue_alias TO app_user;
