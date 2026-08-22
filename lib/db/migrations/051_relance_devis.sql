-- 051 — De quoi relancer un devis resté sans réponse (ticket 4.33).
--
-- ── Pourquoi dans `regles_relance` ────────────────────────────────────────
-- C'est déjà la table des règles de relance, versionnée et append-only : une
-- campagne validée sous la v1 ne doit pas se retrouver rétroactivement régie
-- par la v2. Le délai de relance commerciale obéit exactement à la même
-- exigence, et lui ouvrir une table à part créerait deux endroits où lire la
-- même sorte de décision.
--
-- 7 jours par défaut : une semaine laisse au client le temps de regarder sans
-- laisser l'affaire refroidir. La valeur se règle à l'écran.
ALTER TABLE regles_relance
  ADD COLUMN IF NOT EXISTS relance_devis_jours INTEGER NOT NULL DEFAULT 7;

-- Ni zéro ni négatif : relancer le jour même de l'envoi, ou « avant », n'a
-- aucun sens commercial. Et pas plus d'un trimestre : au-delà le devis est
-- mort, il se refait.
ALTER TABLE regles_relance DROP CONSTRAINT IF EXISTS regles_relance_relance_devis_jours_check;
ALTER TABLE regles_relance
  ADD CONSTRAINT regles_relance_relance_devis_jours_check
  CHECK (relance_devis_jours BETWEEN 1 AND 90);

-- La date de la dernière relance PROPOSÉE pour un devis.
--
-- Sur `devis` et non dans une table de journal : c'est un attribut du devis,
-- lu à chaque campagne pour ne pas le reproposer. Une table séparée obligerait
-- à une jointure sur le chemin le plus fréquent, pour une donnée qui ne sert
-- qu'ici.
ALTER TABLE devis ADD COLUMN IF NOT EXISTS derniere_relance_le DATE;

CREATE INDEX IF NOT EXISTS devis_relance_idx
  ON devis (tenant_id, status, date_envoi)
  WHERE status = 'ENVOYE';
