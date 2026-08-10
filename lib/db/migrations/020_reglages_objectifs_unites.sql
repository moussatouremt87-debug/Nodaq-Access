-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020 — l'unité entre dans le nom du réglage
--
-- `objectifs.taux_marge` était rangé en CENTIÈMES DE POINT (35 % → 3500) et
-- `objectifs.charges_fixes_annuelles` en CENTIMES, derrière des noms qui ne le
-- disaient pas.
--
-- Constaté en écrivant 35 au lieu de 3500 : l'application a affiché, sans
-- broncher, un seuil de rentabilité de 13 714 286 €. Le calcul était juste ;
-- c'est l'entrée qui était absurde, et rien ne l'a refusée.
--
-- Le formulaire convertissait correctement — mais un formulaire n'est pas une
-- garde. `PATCH /parametres` accepte n'importe quelle paire clé/valeur : une
-- reprise de données, une intervention de support ou la couche vocale
-- pouvaient poser la valeur brute.
--
-- Renommage SANS PERTE : les valeurs sont déjà dans la bonne unité, seul le
-- nom change. `ON CONFLICT DO NOTHING` protège une base où la nouvelle clé
-- existerait déjà — la plus récente l'emporte alors, ce qui est le bon choix.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO settings (tenant_id, key, value, updated_at)
SELECT tenant_id, 'objectifs.taux_marge_bp', value, NOW()
  FROM settings WHERE key = 'objectifs.taux_marge'
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO settings (tenant_id, key, value, updated_at)
SELECT tenant_id, 'objectifs.charges_fixes_annuelles_cents', value, NOW()
  FROM settings WHERE key = 'objectifs.charges_fixes_annuelles'
ON CONFLICT (tenant_id, key) DO NOTHING;

-- Les anciennes clés disparaissent : les laisser vivre garantirait qu'un
-- lecteur oublié continue de les lire, et que les deux divergent.
DELETE FROM settings
 WHERE key IN ('objectifs.taux_marge', 'objectifs.charges_fixes_annuelles');
