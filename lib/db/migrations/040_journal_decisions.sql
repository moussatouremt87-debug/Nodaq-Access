-- Migration 040 — journal des décisions sur les actions de l'assistant (US-A6.4)
--
-- Ce que cette table N'EST PAS : un doublon de `pending_actions`.
--
-- `pending_actions` est MUTABLE par construction — son `status` passe de
-- `EN_ATTENTE` à `VALIDEE`/`REJETE`, `decided_at` est posé après coup, et
-- `purgerPlansExpires` sait la supprimer. C'est très bien pour une FILE DE
-- TRAVAIL : on y lit ce qu'il reste à valider. C'est disqualifiant pour une
-- PREUVE : la story (US-A6.4, points d'attention) interdit explicitement de
-- bâtir la traçabilité sur un support modifiable a posteriori.
--
-- D'où un journal séparé, qui n'enregistre que des ACTES : approbation, rejet.
-- Il conserve un INSTANTANÉ du contenu proposé (`action_label`,
-- `action_payload`) plutôt qu'une simple clé étrangère vers `pending_actions` :
-- celle-ci peut disparaître, et une preuve qui pointe vers une ligne effacée
-- ne prouve plus rien.
--
-- ── APPEND-ONLY AU NIVEAU DU MOTEUR ─────────────────────────────────────────
-- Le REVOKE ci-dessous n'est pas décoratif et ne peut pas être délégué à
-- `create-app-role.cjs`. L'`ALTER DEFAULT PRIVILEGES` posé par 002_rls.sql
-- accorde les QUATRE droits à toute table nouvellement créée : sans REVOKE
-- explicite, `app_user` pourrait modifier et effacer ce journal. C'est le
-- piège que 006_archived_pdfs.sql documente et que 009 a laissé passer, ce qui
-- a exigé la migration 010 pour `envois_journal`. On applique ici la leçon dès
-- la création.
--
-- `create-app-role.cjs` ré-applique cette révocation à chaque exécution (son
-- GRANT massif l'annulerait sinon) ; mais le chemin normal `pnpm db:migrate`
-- ne lance pas ce script — la garantie doit donc vivre ICI.
--
-- ── `decidee_par` NULLABLE, et c'est signifiant ─────────────────────────────
-- NULL = expiration : personne n'a décidé, c'est précisément l'information.
-- Une approbation ou un rejet en portent toujours un.
--
-- `decidee_par_email` est un INSTANTANÉ, pas une jointure : un compte révoqué
-- ou supprimé ne doit pas effacer la trace de qui a décidé. Même doctrine que
-- le nom du client figé sur une facture émise.

CREATE TABLE IF NOT EXISTS journal_decisions (
  id                 TEXT        PRIMARY KEY,
  tenant_id          UUID        NOT NULL REFERENCES tenants(id),
  -- Pas de REFERENCES pending_actions : la ligne d'origine peut être purgée,
  -- le journal doit lui survivre.
  action_id          TEXT        NOT NULL,
  action_type        TEXT        NOT NULL,
  action_label       TEXT        NOT NULL,
  action_payload     JSONB,
  decision           TEXT        NOT NULL CHECK (decision IN ('APPROUVEE', 'REJETEE', 'EXPIREE')),
  decidee_le         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- PAS de REFERENCES users(id), et c'est délibéré — même raison que
  -- `action_id` ci-dessus. Une clé étrangère imposerait un choix impossible le
  -- jour où un compte est supprimé : soit refuser la suppression (le journal
  -- prendrait l'utilisateur en otage), soit ON DELETE SET NULL — c'est-à-dire
  -- MODIFIER une ligne d'un journal qu'on vient de déclarer immuable. Le
  -- rattachement se fait par `decidee_par_email`, l'instantané, qui survit à la
  -- disparition du compte.
  decidee_par        UUID,
  decidee_par_email  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journal_decisions_tenant_date_idx
  ON journal_decisions (tenant_id, decidee_le DESC);
CREATE INDEX IF NOT EXISTS journal_decisions_action_idx
  ON journal_decisions (action_id);

ALTER TABLE journal_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_decisions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journal_decisions;
CREATE POLICY tenant_isolation ON journal_decisions
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- L'immuabilité est une règle du MOTEUR, pas une intention du code applicatif.
REVOKE ALL ON journal_decisions FROM app_user;
GRANT SELECT, INSERT ON journal_decisions TO app_user;
