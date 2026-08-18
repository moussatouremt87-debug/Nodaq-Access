-- Migration 039 — accès en lecture seule pour un tiers de confiance (US-A5.4)
--
-- Cas visé : un artisan monte un dossier de prêt et doit ouvrir ses comptes à
-- son banquier. Celui-ci consulte, ne modifie rien, et son accès se referme
-- de lui-même une fois le dossier bouclé.
--
-- Le rôle `VIEWER` ne se distingue PAS des autres par ce que la base
-- l'autorise à écrire : `memberships.role` ne porte aucune contrainte, et la
-- lecture seule est appliquée par une garde structurelle côté application
-- (`middleware/lectureSeule.ts`, montée dans la chaîne `biz`), pas ici. Ce
-- que cette migration ajoute, c'est le VOCABULAIRE (le rôle devient
-- invitable) et l'ÉCHÉANCE.
--
-- Nom de contrainte vérifié en base avant d'écrire cette migration
-- (`SELECT conname FROM pg_constraint WHERE conrelid = 'tenant_invites'::regclass
--   AND contype = 'c'`), pas deviné depuis la convention de nommage implicite
-- de Postgres — même règle que 038, pour la même raison.
--
-- À cette occasion, constat consigné : `memberships` n'a AUCUNE contrainte
-- CHECK sur `role` (seule `tenant_invites` en a une). Volontairement laissé
-- tel quel — l'ajouter maintenant sortirait du périmètre de cette story et
-- toucherait une table que trois autres migrations manipulent déjà.

ALTER TABLE tenant_invites DROP CONSTRAINT tenant_invites_role_check;
ALTER TABLE tenant_invites ADD CONSTRAINT tenant_invites_role_check
  CHECK (role IN ('MEMBER', 'ACCOUNTANT', 'OWNER', 'VIEWER'));

-- Échéance de l'accès, portée par l'ADHÉSION et non par la session : elle
-- survit donc à une reconnexion, et `requireMembership` — qui revérifie
-- l'adhésion à CHAQUE requête — la fait respecter dès la requête suivante,
-- sans attendre l'expiration du cookie.
--
-- NULLABLE, et c'est le point important pour la non-régression : `NULL`
-- signifie « permanent », ce que sont toutes les adhésions existantes. Aucune
-- ligne déjà en base ne change de comportement.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- L'échéance choisie à l'invitation, reportée sur `memberships.expires_at` au
-- moment de l'acceptation. Distincte de `tenant_invites.expires_at`, qui est
-- la durée de validité du LIEN (7 jours) — deux horloges différentes : le
-- délai pour accepter, et la durée de l'accès une fois accepté.
ALTER TABLE tenant_invites ADD COLUMN IF NOT EXISTS acces_expire_at TIMESTAMPTZ;
