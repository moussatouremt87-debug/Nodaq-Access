-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010 — envois_journal : append-only au niveau du moteur
--
-- Un journal que l'application peut modifier ou effacer n'est pas un journal :
-- c'est une table ordinaire avec un nom rassurant.
--
-- La migration 009 a créé la table avec un simple
--   GRANT SELECT, INSERT ON envois_journal TO app_user;
-- ce qui ne retire RIEN. L'`ALTER DEFAULT PRIVILEGES` posé par 002_rls.sql
-- accorde les quatre droits à TOUTE table nouvellement créée : accorder n'en
-- retire aucun. `app_user` disposait donc de UPDATE et DELETE, vérifié par
-- has_table_privilege sur une base réelle.
--
-- C'est exactement le piège que 006_archived_pdfs.sql documente et évite avec un
-- REVOKE explicite. 009 ne l'a pas fait.
--
-- 009 n'est PAS modifiée : elle est déjà appliquée, et une migration livrée ne
-- se réécrit jamais — _migrations indexe par nom de fichier, la rejouer sur les
-- bases existantes n'aurait pas lieu (voir CLAUDE.md, « Conventions »).
--
-- Le REVOKE vit ICI et pas seulement dans create-app-role.cjs : ce script est
-- une réparation, pas une garantie. Il ne protège qu'entre le moment où il
-- tourne et le prochain GRANT massif. Sur le chemin normal `pnpm db:migrate`,
-- qui ne le lance pas, la table resterait modifiable indéfiniment.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON envois_journal FROM app_user;
GRANT SELECT, INSERT ON envois_journal TO app_user;
