-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 013 — magasin de secrets chiffrés
--
-- `canal-emission.ts` portait cette note : « Le mode SMTP de l'artisan est
-- VOLONTAIREMENT ABSENT : il exigerait de stocker son mot de passe et aucun
-- chiffrement au repos n'existe encore. » C'est ce trou qu'on comble, avant
-- qu'un vrai connecteur ne dépose un jeton dans `connectors.config`, qui est du
-- `jsonb` en clair.
--
-- ── UN MAGASIN, PAS DES COLONNES ÉPARPILLÉES ─────────────────────────────────
-- Un seul chemin de code, une seule garde, un seul script de rotation.
-- Chiffrer des colonnes dispersées garantit qu'on en oubliera une le jour où
-- on en ajoute une — et une colonne oubliée reste en clair pour toujours.
--
-- ── PAS D'INDEX SUR LE CHIFFRÉ ───────────────────────────────────────────────
-- Ni index, ni contrainte d'unicité, ni recherche sur `valeur_chiffree` : un
-- chiffré n'est pas comparable, l'IV étant tiré au sort à chaque écriture. Deux
-- chiffrements de la même valeur diffèrent, donc un index d'unicité ne
-- refuserait rien et un index de recherche ne trouverait rien.
-- Si le besoin d'indexer se fait sentir, c'est que la donnée n'est pas un
-- secret et n'a rien à faire ici.
--
-- ── PAS APPEND-ONLY ──────────────────────────────────────────────────────────
-- Contrairement à `envois_journal` ou `archived_pdfs`, un secret se REMPLACE
-- et se RÉVOQUE. Privilèges normaux, UPDATE et DELETE compris.
--
-- ── LE CHIFFREMENT NE SE FAIT PAS ICI ────────────────────────────────────────
-- pgcrypto est activé (migration 001) et n'est délibérément PAS employé : la
-- clé voyagerait dans l'instruction SQL, donc dans `pg_stat_activity`, dans
-- `pg_stat_statements` et dans les journaux du serveur. Cette table ne reçoit
-- que du chiffré, produit par `lib/crypto`. La base ne connaît aucune clé.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_secrets (
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  -- Clé LOGIQUE : « envoi.smtp_password », « connecteur.<id>.<champ> ».
  -- Elle entre dans l'AAD du chiffrement : un chiffré déplacé d'une clé vers
  -- une autre ne se déchiffre plus.
  cle             TEXT        NOT NULL,
  -- Format « v1:<version_cle>:<iv_b64>:<tag_b64>:<chiffre_b64> ».
  valeur_chiffree TEXT        NOT NULL,
  -- Combien de fois CE chiffré a été re-clé. 1 à la première écriture,
  -- incrémenté par rotate-encryption-key.mjs. Donnée d'inventaire : le choix
  -- de la clé au déchiffrement ne s'appuie pas dessus.
  version_cle     INTEGER     NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Le tenant fait partie de la clé primaire ET de l'AAD : deux barrières
  -- indépendantes contre le mélange de secrets entre clients.
  PRIMARY KEY (tenant_id, cle)
);

-- ── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE tenant_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_secrets;
CREATE POLICY tenant_isolation ON tenant_secrets
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_secrets TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- parametres_envoi — le mode « SMTP de l'artisan »
--
-- Les champs NON SECRETS vivent ici, en clair, parce qu'ils n'ouvrent aucun
-- accès : un hôte et un identifiant sans mot de passe ne servent à rien. Le mot
-- de passe, lui, part dans `tenant_secrets` sous « envoi.smtp_password ».
--
-- `dkim_valeur` reste en clair et ce n'est pas un oubli : c'est la clé PUBLIQUE
-- DKIM, publiée dans le DNS par construction. La chiffrer n'aurait aucun sens.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE parametres_envoi ADD COLUMN IF NOT EXISTS smtp_hote        TEXT;
ALTER TABLE parametres_envoi ADD COLUMN IF NOT EXISTS smtp_port        INTEGER;
ALTER TABLE parametres_envoi ADD COLUMN IF NOT EXISTS smtp_utilisateur TEXT;

-- Le troisième mode rejoint les deux existants.
ALTER TABLE parametres_envoi DROP CONSTRAINT IF EXISTS parametres_envoi_mode_check;
ALTER TABLE parametres_envoi ADD  CONSTRAINT parametres_envoi_mode_check
  CHECK (mode IN ('domaine_authentifie', 'smtp_artisan', 'repli_nodaq'));

-- Le journal d'envoi porte le même vocabulaire de modes.
ALTER TABLE envois_journal DROP CONSTRAINT IF EXISTS envois_journal_mode_check;
ALTER TABLE envois_journal ADD  CONSTRAINT envois_journal_mode_check
  CHECK (mode IN ('domaine_authentifie', 'smtp_artisan', 'repli_nodaq'));

-- ─────────────────────────────────────────────────────────────────────────────
-- REPRISE DE `connectors.config`
--
-- Le contenu non sensible reste dans le `jsonb`. Chaque champ sensible sort et
-- va dans `tenant_secrets` sous « connecteur.<id>.<champ> », le `jsonb` n'en
-- gardant que le NOM, sous la forme :
--
--     { "api_url": "https://…", "__secrets": ["api_key", "token"] }
--
-- CE DÉPLACEMENT N'EST PAS FAIT ICI, ET NE PEUT PAS L'ÊTRE. Le déplacer en SQL
-- exigerait de chiffrer en SQL, donc de faire voyager la clé dans l'instruction
-- — précisément ce que ce lot interdit. La reprise est donc un script
-- applicatif : lib/db/scripts/migrate-connector-secrets.mjs. Aucune ligne n'est
-- concernée aujourd'hui ; le script existe pour figer le format avant qu'il y
-- en ait.
--
-- Ce bloc SQL se contente de ce qu'il peut faire honnêtement : constater.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n
    FROM connectors
   WHERE config IS NOT NULL
     AND config::jsonb <> '{}'::jsonb
     AND NOT (config::jsonb ? '__secrets');

  IF n > 0 THEN
    RAISE NOTICE 'connectors : % ligne(s) portent une config non reprise. Lancer node lib/db/scripts/migrate-connector-secrets.mjs', n;
  END IF;
END $$;
