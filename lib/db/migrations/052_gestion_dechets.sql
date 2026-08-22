-- 052 — Mentions de gestion des déchets sur les devis (loi AGEC, ticket 4.35).
--
-- Décret n° 2020-1817 : les devis de travaux de construction, rénovation,
-- démolition et de jardinage doivent porter quatre mentions relatives aux
-- déchets. Un devis qui ne les porte pas est non conforme.
--
-- ── Une colonne JSONB, et pas cinq colonnes ──────────────────────────────
-- Le bloc est un TOUT : il s'affiche ensemble, se valide ensemble, et n'est
-- jamais interrogé champ par champ. Cinq colonnes obligeraient à cinq
-- migrations le jour où le décret en ajoute une, pour une donnée qu'aucune
-- requête ne filtre.
--
-- NULL = devis antérieur au ticket, ou secteur non concerné. La
-- rétrocompatibilité est explicite : les devis existants ne sont pas modifiés,
-- le bloc s'applique aux nouveaux et aux nouvelles versions.
ALTER TABLE devis ADD COLUMN IF NOT EXISTS gestion_dechets JSONB;

COMMENT ON COLUMN devis.gestion_dechets IS
  'Bloc AGEC (décret 2020-1817). NULL = non applicable ou devis antérieur.';
