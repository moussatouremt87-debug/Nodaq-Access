-- Migration 031 — suivi des transmissions sortantes vers une plateforme agréée (US-A2.6)
--
-- Une ligne par document transmis (facture ou agrégat e-reporting), mise à
-- jour au fil des statuts renvoyés par la PA. Contrairement à
-- pa_documents_recus, cette table N'est PAS append-only : le statut évolue
-- légitimement (prete → deposee → recue → …), et lib/plateforme-agreee
-- réexporte isValidTransition() (@nodaq/facturx) pour garantir que les
-- transitions appliquées ici respectent le vocabulaire normatif DGFiP —
-- jamais un retour en arrière, jamais un statut terminal rouvert.
--
-- Le CHECK sur `statut` doit rester synchronisé avec SUBMISSION_STATUSES
-- (lib/facturx/src/lifecycle.ts, LIFECYCLE_RULES_VERSION = 2026-08-01).

CREATE TABLE IF NOT EXISTS pa_transmissions (
  id             TEXT        PRIMARY KEY,
  tenant_id      UUID        NOT NULL REFERENCES tenants(id),
  document_type  TEXT        NOT NULL CHECK (document_type IN ('FACTURE', 'E_REPORTING')),
  document_id    TEXT        NOT NULL,
  submission_id  TEXT,
  statut         TEXT        NOT NULL CHECK (statut IN (
                   'prete', 'deposee', 'recue', 'prise_en_charge',
                   'approuvee', 'approuvee_partiellement', 'refusee',
                   'rejetee', 'encaissee', 'erreur'
                 )),
  erreur         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pa_transmissions_unique_document
    UNIQUE (tenant_id, document_type, document_id)
);

CREATE INDEX IF NOT EXISTS pa_transmissions_tenant_document
  ON pa_transmissions (tenant_id, document_type, document_id);

ALTER TABLE pa_transmissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pa_transmissions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON pa_transmissions;
CREATE POLICY tenant_isolation ON pa_transmissions
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);
