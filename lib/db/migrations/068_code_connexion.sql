-- Connexion par code à usage unique, et appareils de confiance.
--
-- POURQUOI. Le second facteur imposait une application d'authentification à
-- installer, et le redemandait à CHAQUE connexion. Pour un artisan peu à
-- l'aise avec le numérique, ce n'est pas une gêne : c'est un mur. Une
-- authentification qu'on ne sait pas franchir ne protège rien — elle fait
-- abandonner, ou elle finit désactivée pour tout le monde.
--
-- Deux tables, deux durées de vie opposées :
--   codes_connexion      quelques minutes, usage unique
--   appareils_confiance  90 jours, pour ne plus rien demander sur un appareil
--                        déjà prouvé
--
-- NI L'UNE NI L'AUTRE NE PORTE `tenant_id`. Ce sont des tables d'infrastructure
-- attachées à l'UTILISATEUR, comme `sessions` et `users` : une même personne
-- peut appartenir à plusieurs espaces, et son appareil de confiance ne se
-- découpe pas par espace. Elles restent donc hors de `BUSINESS_TABLES` et hors
-- RLS, exactement comme les sessions.

CREATE TABLE IF NOT EXISTS codes_connexion (
  id            text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Le code n'est JAMAIS stocké en clair : seul son condensat vit ici. Une
  -- fuite de cette table ne donne accès à aucun compte.
  code_sha256   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  -- Usage unique : un code accepté est marqué, jamais réutilisable.
  used_at       timestamptz,
  -- Compteur d'essais. Au-delà du seuil, le code est mort — c'est ce qui rend
  -- six chiffres suffisants : sans plafond, 10^6 se force en quelques minutes.
  tentatives    integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS codes_connexion_user_idx
  ON codes_connexion (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS appareils_confiance (
  id            text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Même principe : le jeton posé dans le cookie ne vit ici qu'en condensat.
  jeton_sha256  text NOT NULL UNIQUE,
  -- De quoi permettre à l'utilisateur de reconnaître et révoquer un appareil.
  -- Volontairement grossier : « Chrome sur Mac », pas une empreinte qui
  -- servirait à pister.
  libelle       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  derniere_vue  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  -- Révocation explicite depuis l'écran « Sécurité du compte ».
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS appareils_confiance_user_idx
  ON appareils_confiance (user_id, expires_at DESC);
