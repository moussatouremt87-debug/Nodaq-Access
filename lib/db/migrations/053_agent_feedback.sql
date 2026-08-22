-- Migration 053 — retour à chaud sur les productions de l'agent (4.36, lot C)

-- ── Pourquoi cette table ──────────────────────────────────────────────────
-- Le signal qualité se recueille au moment où l'utilisateur JUGE, pas trois
-- semaines plus tard dans un questionnaire. Un pouce sous un devis généré vaut
-- mieux qu'une enquête de satisfaction : il est daté, rattaché à une
-- production précise, et donné par quelqu'un qui vient de la lire.
--
-- ── Ce que cette table N'EST PAS ──────────────────────────────────────────
-- Ce n'est pas un journal des productions de l'agent. Elle n'existe que
-- lorsqu'un humain a cliqué : l'absence de ligne signifie « personne n'a
-- jugé », jamais « c'était bien ». Compter les silences comme des pouces en
-- l'air ferait mentir toute restitution.
--
-- ── Le verbatim est une donnée SENSIBLE ───────────────────────────────────
-- « Le devis pour Mme Delacroix a raté la ligne de gouttière » nomme un client
-- et décrit un chantier. Même régime que les transcriptions d'appel : jamais
-- journalisé, effaçable, et hors de toute route qui projette sans colonnes.
CREATE TABLE IF NOT EXISTS agent_feedback (
  id                  TEXT        PRIMARY KEY,
  tenant_id           UUID        NOT NULL REFERENCES tenants(id),

  -- Ce que l'agent a produit : devis_genere, facture_lue, resume, relance…
  -- Volontairement TEXTE et non énuméré : chaque nouveau type de production
  -- devrait sinon attendre une migration pour pouvoir être jugé, et c'est
  -- exactement le moment où l'on renonce à recueillir le signal.
  type_production     TEXT        NOT NULL,

  -- La production visée (id du devis, de la conversation, du plan vocal…).
  -- Sans contrainte de clé étrangère : la production peut être purgée, le
  -- jugement porté sur elle garde sa valeur statistique.
  reference_id        TEXT,

  -- Deux valeurs, pas cinq. Une échelle de 1 à 5 invite à la nuance et ne
  -- décide de rien ; un pouce se donne en un clic et se compte sans débat.
  note                TEXT        NOT NULL CHECK (note IN ('POUCE_HAUT','POUCE_BAS')),

  -- Facultatif : « qu'est-ce qui ne va pas ? ». Peut nommer un client.
  verbatim            TEXT,

  -- Qui a jugé — pour distinguer un avis isolé d'un ressenti d'équipe.
  -- Sans clé étrangère vers `users` : supprimer un compte ne doit pas
  -- effacer le signal ni bloquer la suppression.
  auteur_user_id      UUID,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- La restitution lit « par type, sur les N derniers jours » : c'est l'index
-- qui sert, et le seul.
CREATE INDEX IF NOT EXISTS agent_feedback_tenant_idx
  ON agent_feedback (tenant_id, type_production, created_at DESC);

-- Un seul jugement par production et par personne. Sans cette contrainte, un
-- double-clic compterait deux pouces et fausserait le taux — le défaut le plus
-- probable, et le plus silencieux.
CREATE UNIQUE INDEX IF NOT EXISTS agent_feedback_unicite_idx
  ON agent_feedback (tenant_id, type_production, reference_id, auteur_user_id)
  WHERE reference_id IS NOT NULL AND auteur_user_id IS NOT NULL;

ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_feedback FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_feedback;
CREATE POLICY tenant_isolation ON agent_feedback
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Effaçable : le verbatim est une donnée personnelle, pas une preuve
-- comptable. Rien ici ne relève d'une obligation de conservation.
