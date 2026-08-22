-- Migration 055 — qualification à l'inscription (ticket 4.36, lot A)

-- ── Une table, et pas des clés de réglage ─────────────────────────────────
-- Le magasin `settings` sert aux RÉGLAGES : des choses qu'on modifie. Ici on
-- enregistre les réponses d'un parcours, datées, qui alimentent aussi la
-- segmentation et la veille. Les noyer parmi les préférences d'affichage
-- rendrait impossible de répondre à « combien de nos tenants viennent d'un
-- autre logiciel ».
--
-- ── Une ligne par tenant ──────────────────────────────────────────────────
-- Le parcours se fait une fois. Le refaire écrase : ce sont des réponses
-- actuelles, pas un journal.
CREATE TABLE IF NOT EXISTS onboarding_qualification (
  tenant_id           UUID        PRIMARY KEY REFERENCES tenants(id),

  -- EXISTANTE | EN_IMMATRICULATION | EN_PROJET. Les trois répondent OUI à
  -- l'inscription : un fondateur en cours d'immatriculation doit pouvoir tout
  -- préparer. Ce qui se débloque avec le SIREN, c'est l'ÉMISSION de documents
  -- légaux, pas l'accès au produit.
  stade               TEXT        CHECK (stade IN ('EXISTANTE','EN_IMMATRICULATION','EN_PROJET')),

  effectif            TEXT        CHECK (effectif IN ('SEUL','DE_2_A_3','DE_4_A_6','DE_7_A_10','PLUS_DE_10')),

  -- Réponses de VEILLE : elles n'activent rien, elles nous apprennent le
  -- marché. Assumé comme tel plutôt que déguisé en paramétrage.
  gestion_actuelle    TEXT        CHECK (gestion_actuelle IN ('JAMAIS_FAIT','PAPIER_TABLEUR','AUTRE_LOGICIEL')),
  logiciel_actuel     TEXT,

  irritant            TEXT        CHECK (irritant IN ('IMPAYES','PAPERASSE','TRESORERIE','RELANCES','AUTRE')),
  -- Verbatim libre : peut nommer un client ou décrire une situation. Même
  -- régime que les verbatims de `agent_feedback` — jamais journalisé.
  irritant_verbatim   TEXT,

  terminee_le         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE onboarding_qualification ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_qualification FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON onboarding_qualification;
CREATE POLICY tenant_isolation ON onboarding_qualification
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
