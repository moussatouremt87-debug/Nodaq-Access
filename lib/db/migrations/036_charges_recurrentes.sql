-- Migration 036 — charges récurrentes (préalable au prévisionnel de trésorerie, US-A3.5)
--
-- Loyer, salaires, abonnements : des sorties fixes qui reviennent à intervalle
-- régulier, sans facture ni échéance fiscale pour les porter. Aucune table ne
-- les suivait avant ce lot — le prévisionnel de 8 semaines (US-A3.5) en a
-- besoin comme troisième source de sorties, à côté des factures impayées et
-- des échéances fiscales/sociales déjà suivies (`echeances`).
--
-- `cadence` (mensuel/trimestriel/semestriel/annuel) et `category` restent du
-- TEXT validé côté Zod, sans CHECK — même doctrine que `contrats.cadence` et
-- `echeances.type` : une contrainte DB sur une liste appelée à évoluer
-- migrerait à chaque ajout, la validation applicative suffit.
--
-- `active` (booléen simple) plutôt qu'un statut calculé comme `echeances` :
-- une charge récurrente n'a pas de cycle de vie à dériver d'une date, juste
-- « on la compte encore, ou plus » — mettre en pause sans supprimer l'historique
-- de saisie.
--
-- RLS avec `nullif(current_setting(...), '')` DÈS LA CRÉATION — pas le motif
-- brut `current_setting(...)::uuid` que 033 avait réintroduit après le
-- correctif générique de 022 (`022_rls_tenant_vide.sql`, corrigé pour
-- bank_connections/bank_accounts par 035) : `current_setting` rend la chaîne
-- vide, pas NULL, sur une connexion de pool déjà utilisée par une requête
-- authentifiée, et `''::uuid` lève au lieu de filtrer.

CREATE TABLE IF NOT EXISTS charges_recurrentes (
  id           TEXT        PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id),
  label        TEXT        NOT NULL,
  category     TEXT        NOT NULL,
  cadence      TEXT        NOT NULL,
  start_date   TEXT        NOT NULL,
  end_date     TEXT,
  amount_cents INTEGER     NOT NULL,
  active       BOOLEAN     NOT NULL DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS charges_recurrentes_tenant_idx ON charges_recurrentes (tenant_id);

ALTER TABLE charges_recurrentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE charges_recurrentes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON charges_recurrentes;
CREATE POLICY tenant_isolation ON charges_recurrentes
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
