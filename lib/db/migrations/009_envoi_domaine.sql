-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 009 — envoi depuis le domaine de l'artisan
--
-- Un devis de « Toiture Martin » qui arrive depuis nodaq.fr n'est pas compris
-- par le destinataire et finit en indésirables. Deux modes remplacent l'envoi
-- unique :
--
--   'domaine_authentifie' — PRINCIPAL. L'artisan publie SPF et DKIM ; le
--                           courrier part de son domaine. AUCUN secret stocké :
--                           la signature DKIM est faite par le fournisseur.
--   'repli_nodaq'         — REPLI. Envoi depuis nodaq.fr avec un « répondre à »
--                           pointant sur l'artisan, et un avertissement
--                           explicite sur la délivrabilité.
--
-- Le mode « SMTP de l'artisan » est VOLONTAIREMENT ABSENT : il exigerait de
-- stocker son mot de passe de messagerie, et aucun chiffrement au repos
-- n'existe encore dans ce produit. Il fera l'objet d'un lot dédié.
--
-- ── Ce qui est COMMUN et ce qui est PAR DOMAINE ──────────────────────────────
-- La valeur `include:` du SPF est la même pour tous les tenants : elle
-- désigne le service d'envoi, elle vit dans la CONFIGURATION, pas ici.
-- Le sélecteur DKIM et sa valeur sont PROPRES À CHAQUE DOMAINE : ils sont
-- stockés ci-dessous. Sans cette séparation, brancher l'enrôlement
-- automatique demanderait une migration.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parametres_envoi (
  id                TEXT        PRIMARY KEY,
  tenant_id         UUID        NOT NULL REFERENCES tenants(id),
  mode              TEXT        NOT NULL DEFAULT 'repli_nodaq'
                                CHECK (mode IN ('domaine_authentifie', 'repli_nodaq')),
  -- Domaine de l'artisan, sans @ ni protocole : « toituremartin.fr ».
  domaine           TEXT,
  -- Adresse d'expédition affichée, et « répondre à » du mode repli.
  email_expediteur  TEXT,
  nom_expediteur    TEXT,
  -- PAR DOMAINE : fournis par la console du service d'envoi, recopiés ici.
  dkim_selecteur    TEXT,
  dkim_valeur       TEXT,
  -- Dernière vérification DNS réussie. NULL = jamais vérifié.
  verifie_le        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un seul paramétrage par tenant.
  CONSTRAINT parametres_envoi_unique_tenant UNIQUE (tenant_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- envois_journal — traçabilité des envois.
--
-- DONNÉE PERSONNELLE : `destinataire` est l'adresse du client de l'artisan.
-- La table porte donc une durée de conservation explicite (voir
-- ENVOIS_JOURNAL_RETENTION_DAYS dans lib/shared) et une entrée au registre des
-- traitements.
--
-- Ce qui n'est JAMAIS consigné : le corps du message ET son sujet. Le sujet
-- d'un devis contient le nom du client et la référence du chantier — c'est une
-- donnée métier, interdite en journal par CLAUDE.md §6.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS envois_journal (
  id            TEXT        PRIMARY KEY,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  destinataire  TEXT        NOT NULL,
  -- 'DEVIS' | 'FACTURE' | 'AVOIR' — quel type de document, jamais son contenu.
  document_type TEXT        NOT NULL,
  document_id   TEXT,
  mode          TEXT        NOT NULL
                            CHECK (mode IN ('domaine_authentifie', 'repli_nodaq')),
  statut        TEXT        NOT NULL CHECK (statut IN ('envoye', 'echec')),
  -- Message d'erreur du serveur SMTP en cas d'échec. Jamais le corps du mail.
  erreur        TEXT,
  envoye_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS envois_journal_tenant_date_idx
  ON envois_journal (tenant_id, envoye_le DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE parametres_envoi ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametres_envoi FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parametres_envoi;
CREATE POLICY tenant_isolation ON parametres_envoi
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

ALTER TABLE envois_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE envois_journal FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON envois_journal;
CREATE POLICY tenant_isolation ON envois_journal
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON parametres_envoi TO app_user;
-- Le journal est append-only côté application : on n'y revient pas pour
-- réécrire une trace d'envoi. La purge de conservation est faite par le
-- propriétaire, pas par app_user.
GRANT SELECT, INSERT ON envois_journal TO app_user;
