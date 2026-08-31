-- Un quatrième statut d'abonnement : EN_ATTENTE.
--
-- ── POURQUOI PAS RÉUTILISER READONLY ────────────────────────────────────────
--
-- Décision fondateur du 31/08/2026 : plus d'essai gratuit. Les 50 places
-- Fondateurs à 29 €/mois se paient dès l'inscription ; seule une poignée de
-- TPE sélectionnées à la main sont offertes, par dérogation de remise.
--
-- Techniquement, READONLY aurait suffi : le middleware bloque déjà toute
-- écriture. Mais il porte une PHRASE — « L'essai est terminé » — et la dire à
-- quelqu'un qui n'a jamais eu d'essai est le genre de détail qui fait douter
-- du sérieux d'un produit dès sa première minute. Les deux états se bloquent
-- pareil et se racontent différemment.
--
-- ── LES ESSAIS EN COURS NE SONT PAS RÉVOQUÉS ────────────────────────────────
--
-- Cette migration n'écrit AUCUNE ligne. Les tenants déjà en TRIAL gardent leur
-- essai jusqu'à son terme, puis basculent en READONLY comme prévu. Un essai
-- accordé est une promesse faite ; la retirer par migration serait la rompre
-- sans même prévenir. Seules les inscriptions À VENIR naissent EN_ATTENTE.

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_statut_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_statut_check
  CHECK (statut IN ('TRIAL', 'ACTIVE', 'READONLY', 'EN_ATTENTE'));

-- Le DEFAULT suit : un INSERT qui ne précise pas le statut décrit un tenant
-- neuf, et un tenant neuf n'a plus d'essai. `creerAbonnementEnAttente` le pose
-- explicitement de son côté — ce défaut n'est qu'un filet.
ALTER TABLE subscriptions
  ALTER COLUMN statut SET DEFAULT 'EN_ATTENTE';
