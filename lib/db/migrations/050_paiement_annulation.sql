-- 050 — Un troisième sens pour le journal des règlements : ANNULATION.
--
-- ── Pourquoi il manquait, et pourquoi REMBOURSEMENT ne convient pas ────────
-- `paiements` est en AJOUT SEUL : `app_user` n'y a que SELECT et INSERT, et
-- `create-app-role.cjs` ré-applique cette révocation à chaque provisionnement
-- (APPEND_ONLY_TABLES). Un règlement saisi par erreur ne peut donc pas être
-- supprimé — il se corrige par une écriture en sens inverse, comme dans tout
-- journal comptable.
--
-- Restaient deux sens : ENCAISSEMENT et REMBOURSEMENT. Aucun ne dit la vérité
-- ici. Un REMBOURSEMENT est un mouvement RÉEL : de l'argent est reparti chez le
-- client. Une annulation de saisie, non — l'argent n'est jamais arrivé. Les
-- confondre donnerait, sur tout comptage de flux, un encaissement et un
-- remboursement là où il ne s'est rien passé du tout.
--
-- ANNULATION porte donc exactement ce qu'elle est : la correction d'une
-- écriture, et non un mouvement de trésorerie.
--
-- ── Effet sur le solde : aucun changement de code ─────────────────────────
-- `encaisseSurFacture` calcule déjà
--   CASE WHEN sens = 'ENCAISSEMENT' THEN montant_cents ELSE -montant_cents END
-- Le nouveau sens est donc compté en négatif sans qu'une ligne bouge.

ALTER TABLE paiements DROP CONSTRAINT IF EXISTS paiements_sens_check;

ALTER TABLE paiements
  ADD CONSTRAINT paiements_sens_check
  CHECK (sens IN ('ENCAISSEMENT', 'REMBOURSEMENT', 'ANNULATION'));

-- `reference` porte le lien vers l'écriture corrigée, sous la forme
-- « annulation:<id du paiement> ». C'est ce qui rend l'annulation idempotente :
-- sans lui, deux clics successifs contre-passeraient deux fois le même
-- règlement et creuseraient un solde négatif.
--
-- Index partiel : seules les annulations sont recherchées par ce chemin, et
-- elles resteront rares devant les encaissements.
CREATE INDEX IF NOT EXISTS paiements_annulation_reference_idx
  ON paiements (facture_id, reference)
  WHERE sens = 'ANNULATION';
