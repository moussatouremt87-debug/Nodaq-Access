-- Migration 034 — policy étroite pour la résolution de tenant par webhook Bridge
--
-- Le webhook Bridge (POST /webhooks/banque) ne porte AUCUN identifiant
-- NODAQ dans son payload — seulement les identifiants internes Bridge
-- (`user_uuid`, `item_id`, `account_id`), confirmé sur un exemple réel de
-- la documentation (docs.bridgeapi.io/docs/webhooks-events). Contrairement
-- au webhook plateforme-agreee (US-A2.6), qui porte le tenantId dans le
-- SEGMENT D'URL (un webhook par tenant), Bridge n'expose qu'UN SEUL
-- webhook au niveau de toute l'application — impossible d'y coder un
-- tenantId dynamique.
--
-- Il faut donc résoudre `bridge_user_uuid → tenant_id` AVANT de connaître
-- le tenant à passer à `withTenant` — un problème d'œuf et de poule que RLS
-- interdit par construction tant qu'aucun contexte de tenant n'est posé.
--
-- MÊME SOLUTION que `devis_public_token_lookup` (migration 014, jeton
-- d'acceptation public de devis) : une policy PERMISSIVE supplémentaire,
-- combinée en OU avec `tenant_isolation` par PostgreSQL. Elle n'ouvre
-- qu'UNE seule ligne, et seulement si l'appelant connaît déjà le
-- `bridge_user_uuid` exact (assigné par Bridge, non devinable en
-- pratique) — jamais un accès élargi au tenant qui la porte.

CREATE POLICY bank_connections_webhook_lookup ON bank_connections
  FOR SELECT TO app_user
  USING (
    bridge_user_uuid = current_setting('app.bridge_lookup_user_uuid', true)
  );
