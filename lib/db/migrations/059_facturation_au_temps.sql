-- ═══════════════════════════════════════════════════════════════════════════
-- 059 — Facturer le temps passé (US-A2.4) et distinguer le facturable (US-B5.4)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- L'audit du backlog du 23/08/2026 : le produit sait POINTER des heures et les
-- analyser, il ne sait pas les FACTURER. C'est le mode de facturation entier
-- des professions libérales, du conseil et des services aux entreprises —
-- trois des neuf modules sectoriels.
--
-- ── Ce qui n'est PAS créé ici, délibérément ───────────────────────────────
-- Aucune seconde saisie d'heures. Le point d'attention de la story est
-- explicite : « éviter de construire deux systèmes de saisie d'heures
-- parallèles pour un même besoin ». La facture se construit depuis
-- `pointages`, qui existe déjà.

-- ── A. Le taux HORAIRE DE FACTURATION, avec son histoire ──────────────────
--
-- Le troisième critère d'acceptation de US-A2.4 est le plus exigeant : « un
-- taux modifié en cours d'année, une nouvelle facture applique le taux EN
-- VIGUEUR À LA DATE DE LA PRESTATION, pas le taux courant ».
--
-- Une colonne unique ne peut pas tenir cette promesse : elle écrase. Il faut
-- une HISTOIRE — une suite de taux, chacun daté de sa prise d'effet. Facturer
-- en mars un travail de janvier applique alors le taux de janvier, ce qui est
-- la seule lecture défendable devant un client.
--
-- À ne pas confondre avec `company.taux_horaire_reel` (réglages) : celui-là
-- est un COÛT, il sert à calculer une marge. Celui-ci est un PRIX DE VENTE.
-- Les mélanger ferait facturer un client au prix de revient.
CREATE TABLE IF NOT EXISTS taux_horaires (
  id            text PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  /* Le jour où ce taux prend effet. Une DATE métier, jamais un instant. */
  date_effet    date NOT NULL,
  montant_cents integer NOT NULL CHECK (montant_cents > 0),
  /* Un taux peut viser un membre précis — un associé et un junior ne se
     facturent pas au même prix. NULL = le taux de l'entreprise. */
  membre_id     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Deux taux au même jour pour la même cible rendraient le choix arbitraire.
CREATE UNIQUE INDEX IF NOT EXISTS taux_horaires_effet_idx
  ON taux_horaires (tenant_id, date_effet, COALESCE(membre_id, ''));

CREATE INDEX IF NOT EXISTS taux_horaires_lecture_idx
  ON taux_horaires (tenant_id, date_effet DESC);

ALTER TABLE taux_horaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE taux_horaires FORCE ROW LEVEL SECURITY;

CREATE POLICY taux_horaires_tenant ON taux_horaires
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

COMMENT ON TABLE taux_horaires IS
  'Historique des taux horaires de FACTURATION (US-A2.4). Prix de vente, à ne pas confondre avec company.taux_horaire_reel qui est un coût. Une ligne par prise d''effet : facturer en mars un travail de janvier applique le taux de janvier.';

-- ── B. Le temps facturable, distingué (US-B5.4) ───────────────────────────
--
-- « Étant donné une activité enregistrée, alors elle est marquée facturable ou
-- non facturable ; étant donné un indicateur de taux d'occupation, alors il se
-- calcule sur la base de cette distinction plutôt que sur le temps total. »
--
-- Défaut à `true` : le temps pointé sur un chantier ou une mission est
-- facturable jusqu'à preuve du contraire. L'inverse — tout non facturable par
-- défaut — ferait disparaître le chiffre d'affaires de tous les tenants
-- existants au moment de la migration.
ALTER TABLE pointages
  ADD COLUMN IF NOT EXISTS facturable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN pointages.facturable IS
  'Ce temps part-il en facture ? (US-B5.4). Défaut vrai : le temps pointé est facturable jusqu''à preuve du contraire. Les trajets, la reprise d''un défaut, la formation interne se marquent faux — et sortent alors du taux d''occupation comme de la facturation au temps.';

-- ── C. La facture connaît sa provenance ───────────────────────────────────
--
-- Une facture au temps passé doit pouvoir dire de quelle période elle vient.
-- Sans ces bornes, refacturer deux fois les mêmes heures ne se détecte pas —
-- et c'est le client qui paierait deux fois.
ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS heures_du date,
  ADD COLUMN IF NOT EXISTS heures_au date;

COMMENT ON COLUMN factures.heures_du IS
  'Début de la période d''heures facturées, pour une facture au temps passé (US-A2.4). NULL pour toute autre facture.';
