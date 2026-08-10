-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 022 — une policy RLS ne doit pas LEVER, elle doit FILTRER
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  Toutes les policies `tenant_isolation` s'écrivaient :                   ║
-- ║                                                                           ║
-- ║      tenant_id = (current_setting('app.current_tenant_id', true))::uuid   ║
-- ║                                                                           ║
-- ║  Après qu'une transaction a posé le réglage avec `set_config(…, true)`,   ║
-- ║  celui-ci ne redevient PAS nul à la fin de la transaction : il vaut la    ║
-- ║  CHAÎNE VIDE. Et `''::uuid` lève `22P02 invalid input syntax for type     ║
-- ║  uuid: ""` — une ERREUR, pas un filtre.                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Vérifié sur une base réelle, avec la connexion applicative :
--
--   BEGIN; SELECT set_config('app.current_tenant_id', '…', true); COMMIT;
--   BEGIN; SELECT current_setting('app.current_tenant_id', true);
--   → ""   (et non NULL)
--   SELECT count(*) FROM contacts_prospection;
--   → ERREUR 22P02 invalid input syntax for type uuid: ""
--
-- ── QUI EST TOUCHÉ ───────────────────────────────────────────────────────────
-- Toute requête qui ne pose PAS le tenant et qui tombe sur une connexion du
-- pool DÉJÀ UTILISÉE par une requête authentifiée. Autrement dit : les ROUTES
-- PUBLIQUES, dès que le serveur a un peu servi.
--
-- La page publique d'acceptation de devis (`/public/devis/:token/…`) est donc
-- concernée : elle rend 500 par intermittence, selon la connexion qui lui est
-- attribuée. C'est très probablement l'échec intermittent d'`archived-pdfs`
-- observé une fois et jamais reproduit — il n'était pas reproductible parce
-- qu'il dépendait de l'ordre d'attribution des connexions.
--
-- ── LA CORRECTION ────────────────────────────────────────────────────────────
-- `nullif(…, '')` : une chaîne vide redevient NULL, `NULL::uuid` est NULL, le
-- prédicat est NULL, et la ligne est simplement invisible. C'est ce qu'une
-- policy doit faire.
--
-- Réécriture de TOUTES les policies concernées, en parcourant `pg_policies` :
-- les énumérer à la main garantirait d'en oublier une, et une seule oubliée
-- suffit à faire tomber une route publique.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
      FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname = 'tenant_isolation'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.tablename);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = nullif(current_setting(''app.current_tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = nullif(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      r.tablename
    );
  END LOOP;
END $$;

-- ── Les deux policies publiques étroites ─────────────────────────────────────
--
-- Elles comparent des CONDENSATS et non des UUID, donc une chaîne vide ne les
-- faisait pas lever. Elles sont recréées quand même, à l'identique, pour que ce
-- fichier porte l'état complet des policies publiques — un lecteur qui cherche
-- « où sont définies les policies » doit trouver toutes celles qui comptent.

DROP POLICY IF EXISTS devis_public_token_lookup ON devis;
CREATE POLICY devis_public_token_lookup ON devis
  FOR SELECT TO app_user
  USING (
    accept_token_sha256 IS NOT NULL
    AND accept_token_sha256 = current_setting('app.devis_accept_token_sha256', true)
  );

DROP POLICY IF EXISTS contacts_opposition_token_lookup ON contacts_prospection;
CREATE POLICY contacts_opposition_token_lookup ON contacts_prospection
  FOR SELECT TO app_user
  USING (
    opposition_token_sha256 IS NOT NULL
    AND opposition_token_sha256 = current_setting('app.opposition_token_sha256', true)
  );
