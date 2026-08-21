-- Migration 042 — campagne de relance vocale (ticket 4.18, US-1)
--
-- Une campagne = une liste d'appels proposés (qui, quelle facture, quel
-- montant) et le MANDAT que l'agent aura pendant ces appels. Rien ne part sans
-- l'accord du dirigeant : la règle 4 du CLAUDE.md est le point de départ du
-- ticket, et elle n'admet pas d'exception ici.
--
-- ── Pourquoi une table, et pas seulement une `pending_action` ──────────────
-- La `pending_action` reste la FILE DE VALIDATION — c'est elle que le cockpit
-- affiche, et le ticket interdit d'inventer un second mécanisme pour ça. Mais
-- elle est mutable et purgeable par construction (voir 040), alors qu'une
-- campagne validée doit survivre à sa purge : c'est elle qui portera les appels
-- passés, leurs issues et leurs coûts. D'où deux objets, reliés par
-- `pending_action_id`, sans clé étrangère — la ligne d'origine peut disparaître
-- sans emporter la campagne.
--
-- ── Le mandat est FIGÉ à l'approbation ─────────────────────────────────────
-- `mandat` porte, avant validation, ce que le dirigeant a DEMANDÉ ; à
-- l'approbation il est recalculé contre la règle en vigueur et gelé, avec
-- `regle_version`. L'US-1 l'exige : « le mandat effectif est figé dans la
-- pending_action au moment de l'approbation — le modifier ensuite exige une
-- nouvelle validation ». Sans `regle_version`, un changement de règle
-- réécrirait après coup ce qui avait été autorisé (US-9).
--
-- Pas append-only, contrairement à `regles_relance` : le statut d'une campagne
-- change tout au long de sa vie (proposée → validée → terminée). Ce qui doit
-- être immuable, ce sont les DÉCISIONS — et elles vivent déjà dans
-- `journal_decisions`.

CREATE TABLE IF NOT EXISTS campagnes_relance (
  id                  TEXT        PRIMARY KEY,
  tenant_id           UUID        NOT NULL REFERENCES tenants(id),
  -- Pas de REFERENCES pending_actions : la file est purgeable, la campagne non.
  pending_action_id   TEXT        NOT NULL,

  statut              TEXT        NOT NULL DEFAULT 'PROPOSEE'
                        CHECK (statut IN ('PROPOSEE', 'VALIDEE', 'REJETEE', 'TERMINEE')),

  -- Les appels proposés : [{ clientId, factureId, montantCents, numero }].
  -- En JSONB parce que la liste est figée à la proposition et lue en bloc ;
  -- les APPELS réellement passés auront leur propre table (lot 4), avec leurs
  -- issues et leurs coûts.
  appels              JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- Demandé avant validation, EFFECTIF après. Jamais plus large que la règle :
  -- l'invariant est appliqué par `restreindreMandat` (lib/shared), et vérifié
  -- de nouveau au moment du gel.
  mandat              JSONB       NOT NULL,
  -- NULL tant que la campagne n'est pas validée : aucune version ne s'applique
  -- encore. Non nul après, et c'est ce qui rend la campagne relisable des mois
  -- plus tard.
  regle_version       INTEGER,

  -- Fenêtre d'appel (US-2) : heures locales du tenant, jours ouvrés.
  -- Défaut 9h-18h, comme le ticket.
  fenetre_debut_heure INTEGER     NOT NULL DEFAULT 9  CHECK (fenetre_debut_heure BETWEEN 0 AND 23),
  fenetre_fin_heure   INTEGER     NOT NULL DEFAULT 18 CHECK (fenetre_fin_heure BETWEEN 1 AND 24),
  max_tentatives      INTEGER     NOT NULL DEFAULT 3  CHECK (max_tentatives BETWEEN 1 AND 5),

  validee_par_email   TEXT,
  validee_le          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Une fenêtre qui se referme avant de s'ouvrir ne laisserait passer aucun
  -- appel, en silence.
  CHECK (fenetre_fin_heure > fenetre_debut_heure)
);

CREATE INDEX IF NOT EXISTS campagnes_relance_tenant_statut_idx
  ON campagnes_relance (tenant_id, statut, created_at DESC);
CREATE INDEX IF NOT EXISTS campagnes_relance_action_idx
  ON campagnes_relance (pending_action_id);

ALTER TABLE campagnes_relance ENABLE ROW LEVEL SECURITY;
ALTER TABLE campagnes_relance FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON campagnes_relance;
CREATE POLICY tenant_isolation ON campagnes_relance
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
