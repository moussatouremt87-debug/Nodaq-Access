-- Migration 037 — habilitations de salarié (US-A4.4)
--
-- Rien ne portait cette notion avant ce lot : ni table, ni colonne. Une
-- habilitation appartient à un salarié (permis, habilitation électrique,
-- diplôme d'État, carte professionnelle), pas à l'affaire — c'est pourquoi
-- c'est une table liée à `team_members` par `membre_id`, sur le même
-- patron que `absences` (001_initial_schema.sql), pas une clé JSON dans
-- `settings` (qui ne porte qu'UNE valeur par tenant, pas N lignes par
-- salarié).
--
-- `type` (clé stable, ex. "habilitation_electrique") reste du TEXT sans
-- CHECK : la liste proposée par secteur (`habilitationsSuggereesParVertical`,
-- lib/shared) n'est qu'une suggestion de saisie, jamais un catalogue fermé —
-- même doctrine que `charges_recurrentes.category`/`echeances.type`.
--
-- `date_expiration` est NULLABLE : une habilitation sans échéance (un
-- diplôme d'État, par exemple) reste valable indéfiniment — NULL veut dire
-- "sans expiration", jamais "expirée par défaut".
--
-- RLS avec `nullif(current_setting(...), '')` dès la création — patron de
-- 036_charges_recurrentes.sql, pas le motif `::uuid` brut de 033.

CREATE TABLE IF NOT EXISTS team_member_habilitations (
  id              TEXT        PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  membre_id       TEXT        NOT NULL REFERENCES team_members(id),
  type            TEXT        NOT NULL,
  libelle         TEXT        NOT NULL,
  date_expiration DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS team_member_habilitations_tenant_idx ON team_member_habilitations (tenant_id);
CREATE INDEX IF NOT EXISTS team_member_habilitations_membre_expiration_idx ON team_member_habilitations (membre_id, date_expiration);

ALTER TABLE team_member_habilitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_member_habilitations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON team_member_habilitations;
CREATE POLICY tenant_isolation ON team_member_habilitations
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Habilitations requises par une affaire (US-A4.4, AC2) — liste JSON de
-- `type` (mêmes clés que team_member_habilitations.type), même patron que
-- team_members.schedule : un texte JSON sur une table déjà RLS-protégée,
-- pas une nouvelle table de jointure pour une liste courte et rarement
-- modifiée en dehors de la création de l'affaire.
ALTER TABLE affaires ADD COLUMN IF NOT EXISTS habilitations_requises TEXT NOT NULL DEFAULT '[]';
