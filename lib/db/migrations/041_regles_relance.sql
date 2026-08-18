-- Migration 041 — règle de négociation de la relance (ticket 4.18, US-9)
--
-- Ce que le dirigeant autorise son agent vocal à accorder pendant un appel de
-- relance : échelonnement ou non, combien de versements, jusqu'à quand, lien de
-- paiement, remise. Défini UNE FOIS, à froid, dans les paramètres — pas dans
-- l'urgence à chaque campagne.
--
-- ── Pourquoi une table versionnée et non des `settings` ─────────────────────
-- La règle n'est pas un réglage d'affichage : c'est le plafond de ce qu'un
-- agent peut engager au nom de l'entreprise, et un mandat de campagne y fera
-- référence. L'US-9 l'impose : « un changement de règle ne modifie jamais
-- rétroactivement une campagne déjà validée ». Une valeur écrasée en place
-- rendrait cette phrase intenable — la campagne d'hier pointerait vers la règle
-- d'aujourd'hui, et personne ne saurait plus ce qui avait été autorisé au
-- moment de l'approbation.
--
-- Chaque modification INSÈRE donc une nouvelle version. La règle courante est
-- celle de `version` maximale. Les campagnes figent le numéro de version qui
-- s'appliquait.
--
-- ── APPEND-ONLY AU NIVEAU DU MOTEUR ────────────────────────────────────────
-- Même piège que `journal_decisions` (040) : l'`ALTER DEFAULT PRIVILEGES` de
-- 002_rls.sql accorde les quatre droits à toute table nouvellement créée. Sans
-- le REVOKE ci-dessous, `app_user` pourrait réécrire une version passée — et
-- une règle réécrite après coup, c'est un mandat qu'on peut nier avoir donné.
-- `create-app-role.cjs` ré-applique la révocation, mais `pnpm db:migrate` ne
-- lance pas ce script : la garantie doit vivre ICI.
--
-- ── Défauts prudents, et c'est une décision ────────────────────────────────
-- Échelonnement et remise DÉSACTIVÉS. L'US-9 l'exige explicitement :
-- « l'autonomie de négociation est un choix explicite, jamais un défaut
-- silencieux ». Un tenant qui n'a jamais ouvert cet écran a donc un agent qui
-- ne concède rien — il obtient une date, rien de plus.

CREATE TABLE IF NOT EXISTS regles_relance (
  id                          TEXT        PRIMARY KEY,
  tenant_id                   UUID        NOT NULL REFERENCES tenants(id),
  -- Croissant par tenant. C'est ce numéro qu'un mandat de campagne fige.
  version                     INTEGER     NOT NULL,

  -- Ce qui est négociable. Les bornes n'ont de sens que si l'échelonnement
  -- est autorisé ; elles restent renseignées pour que réactiver la règle ne
  -- fasse pas repartir de zéro.
  echelonnement_autorise      BOOLEAN     NOT NULL DEFAULT FALSE,
  max_versements              INTEGER     NOT NULL DEFAULT 3 CHECK (max_versements BETWEEN 1 AND 12),
  delai_max_premier_versement_jours INTEGER NOT NULL DEFAULT 15 CHECK (delai_max_premier_versement_jours BETWEEN 0 AND 90),
  -- Retard maximal acceptable, en jours, par rapport à la date d'échéance de
  -- la facture. Relatif et non absolu : une date absolue serait périmée dès la
  -- campagne suivante.
  retard_max_jours            INTEGER     NOT NULL DEFAULT 30 CHECK (retard_max_jours BETWEEN 0 AND 365),
  lien_paiement_autorise      BOOLEAN     NOT NULL DEFAULT FALSE,
  remise_autorisee            BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Qui a posé cette version. Instantané de l'e-mail en plus de l'identifiant,
  -- même doctrine que `journal_decisions` : un compte supprimé ne doit pas
  -- effacer la trace de qui a autorisé quoi. Pas de REFERENCES users(id) pour
  -- la même raison — la clé étrangère imposerait de choisir entre bloquer la
  -- suppression du compte et modifier une ligne déclarée immuable.
  posee_par                   UUID,
  posee_par_email             TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Une seule ligne par (tenant, version) : c'est ce qui rend le numéro de
  -- version utilisable comme référence stable depuis un mandat de campagne.
  UNIQUE (tenant_id, version)
);

CREATE INDEX IF NOT EXISTS regles_relance_courante_idx
  ON regles_relance (tenant_id, version DESC);

ALTER TABLE regles_relance ENABLE ROW LEVEL SECURITY;
ALTER TABLE regles_relance FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON regles_relance;
CREATE POLICY tenant_isolation ON regles_relance
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Une version posée ne se réécrit pas. Règle du moteur, pas intention du code.
REVOKE ALL ON regles_relance FROM app_user;
GRANT SELECT, INSERT ON regles_relance TO app_user;
