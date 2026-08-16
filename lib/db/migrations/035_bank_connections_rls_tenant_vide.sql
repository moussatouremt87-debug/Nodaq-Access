-- Migration 035 — corrige sur bank_connections/bank_accounts le même défaut
-- que la migration 022 a déjà corrigé partout ailleurs
--
-- 033 (connecteur bancaire) est postérieure à 022 (correctif RLS tenant vide)
-- mais a réintroduit exactement le motif que 022 a éliminé :
--
--     tenant_id = (current_setting('app.current_tenant_id', true))::uuid
--
-- Le balayage de 022 (`FOR r IN SELECT ... FROM pg_policies ...`) ne pouvait
-- réécrire que les policies qui EXISTAIENT au moment où il a tourné — 033 n'a
-- créé bank_connections/bank_accounts que plus tard. Sur une connexion du pool
-- déjà utilisée par une requête authentifiée, `current_setting(..., true)`
-- rend la CHAÎNE VIDE (pas NULL), et `''::uuid` lève 22P02 au lieu de filtrer
-- — exactement le défaut que 022 documente en détail.
--
-- Trouvé en construisant le webhook Bridge (POST /webhooks/banque, migration
-- 034) : `resoudreLocataire()` interroge bank_connections AVANT tout contexte
-- de tenant, sur une connexion de pool potentiellement réutilisée — la policy
-- OR'd tenant_isolation levait alors 500 au lieu de simplement ne rien
-- retourner. Même correctif que 022 : `nullif(…, '')`.

DROP POLICY IF EXISTS tenant_isolation ON bank_connections;
CREATE POLICY tenant_isolation ON bank_connections
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bank_accounts;
CREATE POLICY tenant_isolation ON bank_accounts
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- La policy étroite du webhook (034) est recréée à l'identique, pour la même
-- raison que 022 recrée les siennes : ce fichier doit porter l'état complet
-- des policies qui comptent pour bank_connections, pas seulement le correctif.
DROP POLICY IF EXISTS bank_connections_webhook_lookup ON bank_connections;
CREATE POLICY bank_connections_webhook_lookup ON bank_connections
  FOR SELECT TO app_user
  USING (
    bridge_user_uuid = current_setting('app.bridge_lookup_user_uuid', true)
  );
