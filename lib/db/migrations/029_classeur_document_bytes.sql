-- Migration 029 — contenu réel des documents du Classeur
--
-- `classeur_documents` n'a jamais eu de colonne de contenu : l'upload
-- enregistrait le nom, la catégorie, la taille et le type MIME, mais jetait
-- les octets du fichier. Un document archivé ne pouvait donc plus jamais
-- être rouvert (confirmé en UAT).
--
-- Table séparée volontairement, même raisonnement que 006_archived_pdfs.sql :
-- `GET /classeur` fait un SELECT * sur `classeur_documents` pour lister les
-- métadonnées ; une colonne bytea directement dessus ferait fuiter tous les
-- octets de tous les documents dans chaque réponse de liste.
--
-- Contrairement à archived_pdfs (factures/avoirs émis, immuables par
-- doctrine), un document du Classeur est un document de travail que
-- l'artisan peut supprimer : pas de REVOKE ici, les privilèges par défaut de
-- 002_rls.sql (SELECT/INSERT/UPDATE/DELETE) s'appliquent normalement.

CREATE TABLE IF NOT EXISTS classeur_document_bytes (
  id             TEXT        PRIMARY KEY,
  tenant_id      UUID        NOT NULL REFERENCES tenants(id),
  document_id    TEXT        NOT NULL REFERENCES classeur_documents(id),
  bytes          BYTEA       NOT NULL,
  sha256         TEXT        NOT NULL,
  byte_size      INTEGER     NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT classeur_document_bytes_unique_document
    UNIQUE (document_id)
);

CREATE INDEX IF NOT EXISTS classeur_document_bytes_tenant
  ON classeur_document_bytes (tenant_id, document_id);

ALTER TABLE classeur_document_bytes ENABLE ROW LEVEL SECURITY;
ALTER TABLE classeur_document_bytes FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON classeur_document_bytes;
CREATE POLICY tenant_isolation ON classeur_document_bytes
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);
