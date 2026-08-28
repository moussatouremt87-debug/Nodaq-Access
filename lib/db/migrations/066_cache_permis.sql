-- Cache des permis de construire, par DÉPARTEMENT.
--
-- La source (Sitadel via PermisAPI) est plafonnée à 500 requêtes par mois sur
-- le plan gratuit, et un département par compte. Sans cache, chaque ouverture
-- de l'écran Prospection consommait une requête : le quota s'épuisait en
-- quelques jours et la section répondait 429.
--
-- ── PAS DE tenant_id, ET PAS DE RLS — DÉLIBÉRÉ ──────────────────────────────
-- Cette table ne contient aucune donnée de locataire : uniquement une réponse
-- d'open data publique, identique pour tous, indexée par code de département.
-- Deux artisans du même département DOIVENT lire la même ligne — c'est ce qui
-- divise les appels au lieu de les multiplier.
--
-- La règle 1 du dépôt et la garde `pg_class` de la CI visent les tables qui
-- PORTENT un tenant_id. Celle-ci n'en porte pas : elle est du bon côté de la
-- règle, pas une exception qu'on s'accorde. Voir le commentaire étendu dans
-- lib/db/src/schema/cache_permis.ts.
--
-- Si un jour cette table devait porter la moindre donnée propre à un client,
-- elle changerait de nature et devrait redevenir une table à tenant_id.
CREATE TABLE IF NOT EXISTS cache_permis (
  departement TEXT PRIMARY KEY,
  charge_le   TIMESTAMPTZ NOT NULL DEFAULT now(),
  donnees     JSONB NOT NULL
);

COMMENT ON TABLE cache_permis IS
  'Open data publique mise en cache par département. Aucune donnée de locataire : pas de tenant_id, pas de RLS. Voir 066_cache_permis.sql.';

-- Les droits, EXPLICITEMENT.
--
-- `create-app-role.cjs` pose bien un `ALTER DEFAULT PRIVILEGES`, mais sans
-- `FOR ROLE` : il ne vaut que pour le rôle qui l'a exécuté. En production les
-- migrations tournent sous `nodaq_owner` et non sous `postgres` — c'est
-- exactement l'écart qui avait piégé la migration 065, invisible en local et
-- en CI puisque les deux y migrent sous le même superutilisateur.
--
-- UPDATE est nécessaire : le cache se rafraîchit par ON CONFLICT DO UPDATE.
-- DELETE ne l'est pas — une entrée périmée est écrasée, jamais supprimée.
GRANT SELECT, INSERT, UPDATE ON cache_permis TO app_user;
