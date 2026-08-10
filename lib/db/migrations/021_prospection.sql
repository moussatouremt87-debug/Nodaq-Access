-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 021 — prospection : contacts, bases légales, oppositions
--
-- Le principe qui commande tout : CE N'EST PAS L'INTERFACE QUI DÉCIDE ce qu'on
-- a le droit d'envoyer, C'EST LE SERVEUR, à partir de la base légale
-- enregistrée. Un bouton masqué côté navigateur n'est pas une protection.
--
-- Un contact sans ligne dans `contact_bases` n'est PAS prospectable : il est
-- lisible dans l'application, mais aucun canal ne lui est ouvert.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Les contacts de prospection ──────────────────────────────────────────────
--
-- TABLE DISTINCTE DE `clients`, et c'est délibéré. La conservation impose de
-- purger les contacts de prospection sans interaction depuis trois ans ; purger
-- `clients` supprimerait de vrais clients, dont les factures doivent survivre.
--
-- Les propres clients de l'artisan — le premier niveau, et le meilleur — sont
-- représentés ici par une ligne portant `client_id`. Le lien permet de
-- retrouver la fiche ; la ligne permet de prospecter sans toucher au fichier
-- client.
CREATE TABLE IF NOT EXISTS contacts_prospection (
  id                     TEXT        PRIMARY KEY,
  tenant_id              UUID        NOT NULL REFERENCES tenants(id),
  -- Non nul pour un client existant. Nul pour un prescripteur ou un
  -- particulier repéré ailleurs.
  client_id              TEXT        REFERENCES clients(id),
  nom                    TEXT        NOT NULL,
  type                   TEXT        NOT NULL
                                     CHECK (type IN ('PARTICULIER', 'PRO')),
  email                  TEXT,
  telephone              TEXT,
  adresse                TEXT,
  code_postal            TEXT,
  ville                  TEXT,
  siret                  TEXT,
  -- D'où vient cette ligne : « import fichier prescripteurs 2026-08 », etc.
  -- La SOURCE de la donnée elle-même vit dans `contact_bases.source`.
  origine                TEXT,
  -- Dernière interaction connue, en date métier. Sert la purge.
  derniere_interaction_le DATE,
  -- CONDENSAT du jeton d'opposition. Le jeton ne vit que dans le lien envoyé,
  -- même doctrine que `devis.accept_token_sha256` (migration 014).
  -- chiffrement-derogation: condensat SHA-256, pas un secret réversible, et il
  -- doit rester COMPARABLE — la route publique d'opposition le cherche par
  -- égalité sur une colonne indexée, ce que le magasin de secrets interdit.
  opposition_token_sha256 TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contacts_prospection_tenant_idx
  ON contacts_prospection (tenant_id, type);
CREATE INDEX IF NOT EXISTS contacts_prospection_purge_idx
  ON contacts_prospection (tenant_id, derniere_interaction_le);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_prospection_opposition_token_uidx
  ON contacts_prospection (tenant_id, opposition_token_sha256);

-- ── Les bases légales — APPEND-ONLY ─────────────────────────────────────────
--
-- Une base légale NE SE RÉÉCRIT PAS : un changement est une nouvelle ligne.
-- C'est ce journal qui tient le jour d'un contrôle, et il ne vaut que s'il est
-- immuable. `REVOKE ALL` puis `GRANT SELECT, INSERT` — le REVOKE n'est pas
-- décoratif, `ALTER DEFAULT PRIVILEGES` a déjà tout accordé.
CREATE TABLE IF NOT EXISTS contact_bases (
  id           TEXT        PRIMARY KEY,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id),
  contact_id   TEXT        NOT NULL REFERENCES contacts_prospection(id),
  contact_type TEXT        NOT NULL CHECK (contact_type IN ('PARTICULIER', 'PRO')),
  base         TEXT        NOT NULL CHECK (base IN (
                 'CLIENT_EXISTANT',
                 'INTERET_LEGITIME_PRO',
                 'INTERET_LEGITIME_PARTICULIER',
                 'CONSENTEMENT')),
  -- D'OÙ VIENT LA DONNÉE, en clair : « registre des permis de construire de la
  -- commune de Marly-Gomont », « formulaire du site », « client depuis la
  -- facture F-2024-0031 ». L'article 14 impose de pouvoir le dire à la
  -- personne : une source vague rend l'information impossible à rédiger.
  source       TEXT        NOT NULL,
  -- La formulation EXACTE acceptée, pour un consentement. Un consentement dont
  -- on ne sait plus à quoi il portait n'est pas un consentement.
  texte_exact  TEXT,
  obtenue_le   DATE        NOT NULL,
  -- Information de l'article 14. NULL = pas encore informée.
  informee_le  DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contact_bases_tenant_contact_idx
  ON contact_bases (tenant_id, contact_id, created_at DESC);

-- ── Les oppositions — APPEND-ONLY ───────────────────────────────────────────
--
-- L'opposition porte sur une EMPREINTE de l'e-mail et du téléphone, salée par
-- tenant — PAS sur l'identifiant du contact.
--
-- La raison est le cas réel : un fichier réimporté crée de nouvelles lignes,
-- avec de nouveaux identifiants. Une opposition rattachée à l'identifiant
-- ressusciterait la personne au premier réimport. L'empreinte, elle, survit :
-- c'est la personne qu'on a exclue, pas la ligne.
--
-- Salée par tenant pour qu'un tenant ne puisse pas tester si une adresse
-- figure dans les oppositions d'un autre.
CREATE TABLE IF NOT EXISTS oppositions (
  id         TEXT        PRIMARY KEY,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id),
  -- SHA-256 de « <sel du tenant>|<email ou téléphone normalisé> ».
  empreinte  TEXT        NOT NULL,
  -- 'email' | 'telephone' — ce qui a été empreint, pour l'inventaire.
  nature     TEXT        NOT NULL CHECK (nature IN ('email', 'telephone')),
  -- Comment elle est arrivée : 'lien', 'saisie', 'reponse'.
  origine    TEXT        NOT NULL DEFAULT 'lien',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oppositions_tenant_empreinte_idx
  ON oppositions (tenant_id, empreinte);

-- ── Row-Level Security ───────────────────────────────────────────────────────

ALTER TABLE contacts_prospection ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts_prospection FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contacts_prospection;
CREATE POLICY tenant_isolation ON contacts_prospection
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

ALTER TABLE contact_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_bases FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contact_bases;
CREATE POLICY tenant_isolation ON contact_bases
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

ALTER TABLE oppositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oppositions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON oppositions;
CREATE POLICY tenant_isolation ON oppositions
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

-- ── Privilèges ───────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON contacts_prospection TO app_user;

-- Append-only. Le REVOKE d'abord : un GRANT restreint ne retire rien.
REVOKE ALL ON contact_bases FROM app_user;
GRANT SELECT, INSERT ON contact_bases TO app_user;

REVOKE ALL ON oppositions FROM app_user;
GRANT SELECT, INSERT ON oppositions TO app_user;

-- ── Policy publique pour le lien d'opposition ───────────────────────────────
--
-- Le lien d'opposition est accessible SANS AUTHENTIFICATION : la personne qui
-- s'oppose n'a pas de compte. Même mécanique que l'acceptation de devis — une
-- policy étroite laisse voir UNE ligne, celle dont le condensat correspond au
-- réglage de session.
DROP POLICY IF EXISTS contacts_opposition_token_lookup ON contacts_prospection;
CREATE POLICY contacts_opposition_token_lookup ON contacts_prospection
  FOR SELECT TO app_user
  USING (
    opposition_token_sha256 IS NOT NULL
    AND opposition_token_sha256 = current_setting('app.opposition_token_sha256', true)
  );

-- Sel d'empreinte par tenant, engendré à la volée et conservé en réglage.
-- Rien à faire ici : `settings` existe déjà et porte la clé
-- « prospection.sel_empreinte ».
