-- Droits explicites d'`app_user` sur les tables de connexion.
--
-- POURQUOI CETTE MIGRATION EXISTE, alors que `create-app-role.cjs` pose des
-- privilèges PAR DÉFAUT qui couvrent déjà les tables créées ensuite par le
-- propriétaire (c'est pourquoi 064 et 065 n'ont aucun GRANT).
--
-- Parce que ces privilèges par défaut ne sont vérifiables que sur une base à
-- laquelle on a accès, et que l'enjeu ici n'est pas un écran vide : c'est un
-- VERROUILLAGE DE CONNEXION. Si `app_user` ne peut pas écrire dans
-- `codes_connexion`, aucun patron non enrôlé ne peut plus entrer — et le
-- correctif exigerait précisément l'accès qu'on vient de perdre.
--
-- Une supposition invérifiable qui coûte un verrouillage se remplace par une
-- ligne explicite. `GRANT` est idempotent : sur une base où les défauts ont
-- fonctionné, cette migration ne change rien.
--
-- Même geste que 066_cache_permis.sql, pour la même raison.

GRANT SELECT, INSERT, UPDATE, DELETE ON codes_connexion     TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON appareils_confiance TO app_user;
