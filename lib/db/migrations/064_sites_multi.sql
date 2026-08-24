-- ═══════════════════════════════════════════════════════════════════════════
-- 064 — Un contrat, plusieurs sites (US-B7.1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Une entreprise de nettoyage ou de sécurité signe UN contrat avec un client
-- qui a huit agences. La story : « chaque site associé peut être planifié et
-- suivi indépendamment tout en remontant à une facturation consolidée pour le
-- client ». Sans cette table, il fallait huit contrats — donc huit factures
-- mensuelles à un client qui en attend une.
--
-- ── Le montant vit sur le SITE, et ce n'est pas un détail ─────────────────
-- Un contrat ne portait qu'un montant global (`contrats.amount_cents`) et
-- aucune ligne : c'est la limite signalée en livrant US-A2.3, et la voici
-- levée. Chaque site porte son propre montant — une agence de 400 m² ne se
-- facture pas comme un local de 60 — et la facture consolidée en fait une
-- ligne par site. Le client reçoit un document qu'il peut vérifier agence par
-- agence, ce qu'un total unique ne permet pas.
--
-- `montant_cents` reste NULLABLE : un site peut exister pour être planifié
-- sans être facturé séparément (une tournée incluse dans un forfait global).
-- Le montant du contrat sert alors de repli.
CREATE TABLE IF NOT EXISTS sites (
  id           text PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  /* Le client dont ce site dépend. Un site sans client n'a pas de sens :
     c'est le client qu'on facture, pas le bâtiment. */
  client_id    text NOT NULL,
  /* Le contrat qui le couvre. NULL = site connu mais hors contrat récurrent
     (une intervention ponctuelle sur un bâtiment déjà référencé). */
  contrat_id   text,
  libelle      text NOT NULL,
  adresse      text,
  code_postal  text,
  ville        text,
  montant_cents integer CHECK (montant_cents IS NULL OR montant_cents >= 0),
  /* Un site fermé ne se planifie plus et sort de la facturation, sans que son
     historique disparaisse — ce qui serait le cas si on le supprimait. */
  actif        boolean NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Deux sites du même libellé sous le même contrat rendraient la facture
-- illisible : « Agence Nord » deux fois, pour deux montants différents.
CREATE UNIQUE INDEX IF NOT EXISTS sites_contrat_libelle_idx
  ON sites (tenant_id, contrat_id, libelle)
  WHERE contrat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sites_client_idx ON sites (tenant_id, client_id);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;

CREATE POLICY sites_tenant ON sites
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

COMMENT ON TABLE sites IS
  'Les sites couverts par un contrat multi-sites (US-B7.1). Chaque site se planifie et se suit indépendamment ; la facturation, elle, reste consolidée par client — une ligne par site sur une seule facture.';

-- ── Le planning par site ──────────────────────────────────────────────────
-- Une affectation pouvait viser une affaire ou un client. Elle peut désormais
-- viser un SITE : c'est ce que demande « planifié indépendamment ». Sans cette
-- colonne, planifier huit agences revenait à huit lignes indistinguables sur
-- le même client.
ALTER TABLE affectations ADD COLUMN IF NOT EXISTS site_id text;

CREATE INDEX IF NOT EXISTS affectations_site_idx ON affectations (tenant_id, site_id);

COMMENT ON COLUMN affectations.site_id IS
  'Le site précis de cette affectation (US-B7.1). NULL pour une affectation rattachée à une affaire ou à un client sans distinction de site.';
