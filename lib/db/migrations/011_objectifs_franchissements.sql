-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011 — franchissements d'objectifs
--
-- Enregistre qu'un objectif a été franchi, une fois et une seule, pour un
-- exercice donné. C'est la table qui rend le franchissement IDEMPOTENT.
--
-- Le cas qu'elle empêche : une facture fait passer au-dessus du seuil, un avoir
-- fait repasser dessous, une nouvelle facture repasse au-dessus. Sans trace, le
-- produit annoncerait deux fois le même franchissement — et la deuxième
-- annonce, sur un chiffre qui a fait l'aller-retour, ne veut plus rien dire.
--
-- La contrainte d'unicité (tenant_id, objectif, exercice) porte la garantie :
-- ce n'est pas au code applicatif de se souvenir, c'est au moteur de refuser.
--
-- Cette table n'envoie RIEN. La notification attend d'avoir un utilisateur ;
-- seule la trace est posée maintenant, pour que le jour où elle arrive, elle
-- n'ait pas à rejouer un historique qu'on n'aurait pas conservé.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS objectifs_franchissements (
  id           TEXT        PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id),
  -- 'exercice_precedent' | 'seuil_rentabilite'
  objectif     TEXT        NOT NULL
                           CHECK (objectif IN ('exercice_precedent', 'seuil_rentabilite')),
  -- Année civile de l'exercice concerné. La bascule d'exercice repart donc de
  -- zéro sans rejouer le franchissement de l'année précédente.
  exercice     INTEGER     NOT NULL,
  -- Montant atteint au moment du franchissement, en centimes. Conservé pour
  -- pouvoir expliquer la trace, jamais recalculé après coup.
  montant_cents INTEGER    NOT NULL,
  franchi_le   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT objectifs_franchissements_unique
    UNIQUE (tenant_id, objectif, exercice)
);

CREATE INDEX IF NOT EXISTS objectifs_franchissements_tenant_exercice_idx
  ON objectifs_franchissements (tenant_id, exercice);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE objectifs_franchissements ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectifs_franchissements FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON objectifs_franchissements;
CREATE POLICY tenant_isolation ON objectifs_franchissements
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

-- Append-only : une trace de franchissement ne se réécrit pas. Le REVOKE est
-- ICI et pas seulement dans create-app-role.cjs — l'ALTER DEFAULT PRIVILEGES de
-- 002_rls.sql accorde les quatre droits à toute table nouvellement créée, et
-- accorder n'en retire aucun (voir 010, qui a corrigé exactement cet oubli).
REVOKE ALL ON objectifs_franchissements FROM app_user;
GRANT SELECT, INSERT ON objectifs_franchissements TO app_user;
