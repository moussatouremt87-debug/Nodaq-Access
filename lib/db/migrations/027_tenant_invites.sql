-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 027 — invitations de collaborateurs
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  AUCUNE INVITATION NE PEUT DONNER LE RÔLE OWNER.                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Le propriétaire d'un tenant est fixé à sa création (register), jamais
-- attribué par invitation. La contrainte CHECK ci-dessous le rend impossible
-- en base, pas seulement côté Zod — une frontière applicative peut se
-- contourner, une contrainte de base non.
--
-- ── LE JETON NE VIT QUE SOUS FORME DE CONDENSAT ─────────────────────────────
-- Même doctrine que 014_devis_accept_token_sha256.sql : le jeton en clair ne
-- transite que dans le lien envoyé par e-mail, jamais stocké. digest() sans
-- clé — même justification que 014, rien de neuf ne transite par pgcrypto ici.
--
-- ── L'INDEX UNIQUE N'EST PAS PRÉFIXÉ PAR TENANT ─────────────────────────────
-- Contrairement à devis_tenant_accept_token_sha256_uidx, la consultation
-- publique d'un jeton d'invitation n'a PAS ENCORE de contexte tenant au
-- moment où on la reçoit — c'est justement ce que la consultation doit
-- révéler. L'unicité porte donc sur le jeton seul.
--
-- ── SELECT, INSERT, UPDATE — PAS DELETE ─────────────────────────────────────
-- Une invitation n'est jamais supprimée : acceptée (accepted_at posé) ou
-- laissée expirer. UPDATE est nécessaire pour poser accepted_at ; DELETE ne
-- correspond à aucun chemin de ce lot. Voir create-app-role.cjs, qui
-- réapplique cette restriction à chaque exécution (le GRANT massif de ce
-- script rendrait DELETE sinon).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_invites (
  id            TEXT        PRIMARY KEY,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  email         TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('MEMBER', 'ACCOUNTANT')),
  -- chiffrement-derogation: condensat SHA-256, pas un secret réversible — même
  -- nature que devis.accept_token_sha256 (014) et users.password_hash. Rien à
  -- en tirer même en clair, aucun accès chez un tiers.
  token_sha256  TEXT        NOT NULL,
  invited_by    UUID        NOT NULL REFERENCES users(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_invites_token_sha256_uidx
  ON tenant_invites (token_sha256);

CREATE INDEX IF NOT EXISTS tenant_invites_tenant_pending_idx
  ON tenant_invites (tenant_id)
  WHERE accepted_at IS NULL;

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE tenant_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invites FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tenant_invites;
CREATE POLICY tenant_isolation ON tenant_invites
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Policy étroite pour la consultation PUBLIQUE par jeton (avant que le
-- tenant soit connu) — même patron que devis_public_token_lookup (014) :
-- le réglage de session porte le condensat, jamais le jeton en clair.
DROP POLICY IF EXISTS tenant_invites_public_token_lookup ON tenant_invites;
CREATE POLICY tenant_invites_public_token_lookup ON tenant_invites
  FOR SELECT TO app_user
  USING (
    token_sha256 IS NOT NULL
    AND token_sha256 = current_setting('app.invite_token_sha256', true)
  );

-- Append-only sauf pour accepted_at : REVOKE explicite, pas seulement
-- supposé — voir 010, qui a corrigé exactement cet oubli sur une autre
-- table.
REVOKE ALL ON tenant_invites FROM app_user;
GRANT SELECT, INSERT, UPDATE ON tenant_invites TO app_user;
