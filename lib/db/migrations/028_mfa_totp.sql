-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 028 — MFA (TOTP) obligatoire pour OWNER/ACCOUNTANT
--
-- Ticket 4.15, phase 1. Déclencheur : un schéma d'attaque documenté et
-- récurrent — des identifiants VALIDES compromis, utilisés pour une lecture
-- en masse à travers plusieurs tenants. La RLS et withTenant protègent contre
-- un tenant qui lit un AUTRE tenant ; ils ne protègent pas contre une identité
-- autorisée qui lit BEAUCOUP de tenants d'un coup — exactement le profil
-- d'une session ACCOUNTANT légitime, indiscernable d'une session compromise
-- sans cette couche.
--
-- ── users/sessions : tables INFRA, pas de RLS ────────────────────────────────
-- Comme password_hash déjà présent sur users, ces colonnes ne portent pas de
-- tenant_id et n'ont jamais eu de policy — lues directement par authService.ts,
-- jamais via withTenant. Rien à ajouter ici de ce côté.
--
-- ── Pourquoi mfa_verified_at vit sur sessions, pas sur users ─────────────────
-- Le MFA se prouve UNE FOIS PAR CONNEXION, pas une fois pour toutes. Un cookie
-- de session volé sur un appareil qui n'a jamais passé le MFA ne doit pas
-- hériter d'un MFA validé sur un autre appareil. C'est le même raisonnement
-- que expires_at, déjà porté par sessions et non par users.
--
-- ── Pourquoi mfa_enabled_at est un timestamp, pas un booléen ─────────────────
-- Distingue « jamais enrôlé » (NULL) de « enrôlé » sans deuxième colonne, et
-- donne un journal d'audit gratuit (quand le MFA a-t-il été activé) — même
-- idiome que created_at/last_login_at déjà sur cette table.
--
-- ── Pourquoi le secret est chiffré via @nodaq/crypto, jamais en clair ────────
-- Un secret TOTP est exactement ce que CLAUDE.md §6 vise : ce qui ouvre un
-- accès (ici, à l'identité elle-même). Même doctrine que tenant_secrets — la
-- valeur ne transite jamais en clair par la base, et son AAD (voir
-- lib/crypto) est scopée par l'id UTILISATEUR, pas par un tenant : un secret
-- MFA n'appartient à aucun tenant en particulier, il authentifie la personne.
--
-- ── Codes de récupération ────────────────────────────────────────────────────
-- Sans eux, un OWNER qui perd son authenticator app est bloqué hors de son
-- propre tenant, sans recours hors intervention manuelle en base — risque
-- opérationnel sévère pour un produit où chaque tenant n'a le plus souvent
-- qu'un seul OWNER. Dix codes à usage unique, générés à l'enrôlement, montrés
-- UNE SEULE FOIS, hashés comme un mot de passe (jamais stockés en clair) :
-- {hash, usedAt} par entrée, jsonb plutôt qu'une table séparée — dix courtes
-- entrées par utilisateur ne justifient pas une jointure.
-- ─────────────────────────────────────────────────────────────────────────────

-- chiffrement-derogation: secret réversible, mais chiffré par le même
-- @nodaq/crypto que tenant_secrets (AAD scopée sur l'id UTILISATEUR, pas un
-- tenant — voir l'en-tête ci-dessus). Il ne rejoint pas tenant_secrets parce
-- que sa clé primaire (tenant_id, cle) suppose un tenant ; un secret MFA n'en
-- a aucun. Même garantie de confidentialité, table différente par nécessité
-- de schéma, pas par contournement.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_chiffre TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery_codes JSONB;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;
