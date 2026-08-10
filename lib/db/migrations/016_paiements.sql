-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 016 — journal des paiements
--
-- Il n'y en avait pas. Une facture portait un booléen « soldée » et
-- `POST /factures/:id/payer` la basculait EN ENTIER. Ni date de règlement, ni
-- montant, ni acompte, ni paiement partiel : un artisan qui encaisse 3 000 €
-- sur une facture de 10 000 € n'avait aucun moyen de l'écrire.
--
-- ── APPEND-ONLY, IMPOSÉ PAR LE MOTEUR ───────────────────────────────────────
-- Même doctrine que `archived_pdfs` et `envois_journal`. Un journal de
-- paiements qui se réécrit ne prouve rien : une erreur se corrige par une
-- écriture INVERSE (`sens = 'REMBOURSEMENT'`), jamais par un UPDATE.
--
-- `REVOKE ALL` puis `GRANT SELECT, INSERT` — dans cet ordre, et le REVOKE n'est
-- pas décoratif : `ALTER DEFAULT PRIVILEGES` a déjà accordé les quatre droits,
-- et un `GRANT SELECT, INSERT` seul ne retire RIEN. C'est l'erreur commise en
-- PR #15 et corrigée par la migration 010.
--
-- Et il faut AUSSI l'ajouter à APPEND_ONLY_TABLES dans create-app-role.cjs :
-- son GRANT massif défait cette révocation à chaque exécution.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS paiements (
  id            TEXT        PRIMARY KEY,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  -- Les trois rattachements sont nullables et indépendants : un acompte
  -- encaissé AVANT toute facture porte `facture_id` nul et `affaire_id`
  -- renseigné. C'est le cas courant sur un chantier, il doit marcher.
  client_id     TEXT,
  facture_id    TEXT,
  affaire_id    TEXT,
  -- Date MÉTIER du règlement (`YYYY-MM-DD`), pas l'instant de la saisie.
  date          DATE        NOT NULL,
  montant_cents INTEGER     NOT NULL CHECK (montant_cents > 0),
  -- Le signe est porté par `sens`, jamais par le montant : un montant négatif
  -- se glisse dans une somme sans qu'on le voie.
  sens          TEXT        NOT NULL DEFAULT 'ENCAISSEMENT'
                            CHECK (sens IN ('ENCAISSEMENT', 'REMBOURSEMENT')),
  moyen         TEXT        NOT NULL DEFAULT 'AUTRE'
                            CHECK (moyen IN ('VIREMENT', 'CHEQUE', 'ESPECES', 'CB', 'AUTRE')),
  nature        TEXT        NOT NULL DEFAULT 'AUTRE'
                            CHECK (nature IN ('ACOMPTE', 'SITUATION', 'SOLDE', 'AUTRE')),
  reference     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS paiements_tenant_facture_idx ON paiements (tenant_id, facture_id);
CREATE INDEX IF NOT EXISTS paiements_tenant_affaire_idx ON paiements (tenant_id, affaire_id);
CREATE INDEX IF NOT EXISTS paiements_tenant_date_idx    ON paiements (tenant_id, date);

ALTER TABLE paiements ENABLE ROW LEVEL SECURITY;
ALTER TABLE paiements FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON paiements;
CREATE POLICY tenant_isolation ON paiements
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

REVOKE ALL ON paiements FROM app_user;
GRANT SELECT, INSERT ON paiements TO app_user;
