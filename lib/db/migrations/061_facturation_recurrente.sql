-- ═══════════════════════════════════════════════════════════════════════════
-- 061 — Facturer les échéances d'un contrat récurrent (US-A2.3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Les contrats portent déjà une cadence et une date de début, et
-- `planOccurrences` sait dire lesquelles sont dues. Ce qui manquait : rien ne
-- MATÉRIALISAIT ces échéances en factures. Le contrat était un rappel, pas une
-- facturation récurrente.
--
-- ── L'idempotence appartient au moteur ────────────────────────────────────
-- Une facture porte le contrat dont elle vient ET l'échéance qu'elle règle.
-- L'index unique interdit alors de facturer deux fois la même échéance — ce
-- qui, sur un abonnement mensuel, se produirait au premier double clic ou à la
-- première relance du script.
--
-- Même doctrine que `devis_id` (migration 049) : un contrôle applicatif
-- « cette échéance est-elle déjà facturée ? » se contourne par deux requêtes
-- simultanées, qui lisent « non » toutes les deux.
ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS contrat_id text,
  ADD COLUMN IF NOT EXISTS echeance_le date;

CREATE UNIQUE INDEX IF NOT EXISTS factures_contrat_echeance_idx
  ON factures (tenant_id, contrat_id, echeance_le)
  WHERE contrat_id IS NOT NULL;

COMMENT ON COLUMN factures.contrat_id IS
  'Le contrat récurrent dont cette facture matérialise une échéance (US-A2.3). NULL pour toute autre facture.';

COMMENT ON COLUMN factures.echeance_le IS
  'L''échéance précise que cette facture règle. Avec contrat_id, elle forme la clé d''unicité : une échéance ne se facture qu''une fois.';
