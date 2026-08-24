-- ═══════════════════════════════════════════════════════════════════════════
-- 062 — Attestation fiscale annuelle des services à la personne (US-B4.1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Un particulier qui emploie une entreprise de services à la personne bénéficie
-- d'un crédit d'impôt de 50 % (art. 199 sexdecies du CGI). Il lui faut pour
-- cela une attestation annuelle, que le prestataire doit lui adresser avant le
-- 31 mars de l'année suivante.
--
-- ── Ce que cette table porte, et ce qu'elle NE porte PAS ──────────────────
-- Elle FIGE les montants au moment de la génération. C'est le point : une
-- attestation régénérée l'an prochain doit afficher exactement le même chiffre
-- que celle qui est partie chez le client — un encaissement corrigé après coup
-- ne doit pas changer un document déjà transmis à l'administration.
--
-- Elle ne porte AUCUN PDF. La règle du dépôt est explicite : jamais de colonne
-- volumineuse sur une table qu'une route liste, sinon les octets partent dans
-- la réponse JSON. Le document se reconstruit à l'identique depuis ces
-- montants figés, ce qui est la même garantie sans le poids.
CREATE TABLE IF NOT EXISTS attestations_sap (
  id                     text PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  client_id              text NOT NULL,
  /* L'année civile attestée. Une DATE serait fausse : c'est un exercice. */
  annee                  integer NOT NULL CHECK (annee >= 2000 AND annee <= 2200),
  /* Ce que le client a réellement déboursé — la base du crédit d'impôt. */
  montant_eligible_cents integer NOT NULL CHECK (montant_eligible_cents > 0),
  /* Les aides d'un tiers, affichées à part et jamais additionnées. */
  aides_cents            integer NOT NULL DEFAULT 0 CHECK (aides_cents >= 0),
  genere_le              timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Une attestation par client et par année. L'unicité appartient au moteur :
-- un double clic sur « générer pour tous mes clients » enverrait sinon deux
-- documents fiscaux contradictoires au même particulier.
CREATE UNIQUE INDEX IF NOT EXISTS attestations_sap_client_annee_idx
  ON attestations_sap (tenant_id, client_id, annee);

CREATE INDEX IF NOT EXISTS attestations_sap_annee_idx
  ON attestations_sap (tenant_id, annee);

ALTER TABLE attestations_sap ENABLE ROW LEVEL SECURITY;
ALTER TABLE attestations_sap FORCE ROW LEVEL SECURITY;

CREATE POLICY attestations_sap_tenant ON attestations_sap
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

COMMENT ON TABLE attestations_sap IS
  'Attestations fiscales annuelles des services à la personne (US-B4.1). Les montants sont FIGÉS à la génération : une attestation régénérée doit afficher le même chiffre que celle transmise au client et à l''administration.';
