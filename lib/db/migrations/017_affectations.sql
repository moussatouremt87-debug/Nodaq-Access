-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 017 — affectations : LE PRÉVU
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  `affectations` = ce qui est PRÉVU.   `pointages` = ce qui a été FAIT.    ║
-- ║                                                                           ║
-- ║  UNE HEURE PRÉVUE N'ENTRE JAMAIS DANS LE CALCUL D'UNE MARGE.             ║
-- ║                                                                           ║
-- ║  C'est la séparation qui commande ce lot. Les confondre gonflerait le     ║
-- ║  coût de main-d'œuvre d'un chantier avec des heures que personne n'a      ║
-- ║  travaillées — et la marge affichée au patron deviendrait une fiction.    ║
-- ║  Un chantier prévu sur un mois puis annulé au bout de trois jours ne      ║
-- ║  coûte pas un mois de salaire.                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Le planning d'un salarié était une semaine type qui se répète. Une
-- affectation datée du 27 août au 27 septembre n'avait pas de table : elle
-- n'existait nulle part, donc aucune commande vocale ne pouvait y atterrir.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS affectations (
  id                     TEXT        PRIMARY KEY,
  tenant_id              UUID        NOT NULL REFERENCES tenants(id),
  affaire_id             TEXT        NOT NULL,
  membre_id              TEXT        NOT NULL,
  -- Dates MÉTIER (`YYYY-MM-DD`), en composantes locales. Jamais un instant :
  -- une affectation qui commence « le 27 août » commence le 27 août à Paris.
  date_debut             DATE        NOT NULL,
  date_fin               DATE        NOT NULL,
  heures_par_jour        NUMERIC(4,2) NOT NULL CHECK (heures_par_jour > 0 AND heures_par_jour <= 24),
  jours_ouvres_seulement BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Une période qui finit avant de commencer n'est pas une période. La garde
  -- est ici, dans le moteur, en plus de la validation Zod de la route : une
  -- reprise de données ou un script ne passent pas par Zod.
  CONSTRAINT affectations_periode_coherente CHECK (date_fin >= date_debut)
);

CREATE INDEX IF NOT EXISTS affectations_tenant_periode_idx
  ON affectations (tenant_id, date_debut, date_fin);
CREATE INDEX IF NOT EXISTS affectations_tenant_membre_idx
  ON affectations (tenant_id, membre_id);

ALTER TABLE affectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE affectations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON affectations;
CREATE POLICY tenant_isolation ON affectations
  USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON affectations TO app_user;

-- Rappel porté par la table qui compte l'autre moitié : `pointages` est le
-- RÉALISÉ, et lui seul entre dans une marge.
COMMENT ON TABLE pointages IS
  'Heures RÉALISÉES et confirmées. Seule source du coût de main-d''œuvre d''une marge. Le prévu vit dans affectations et n''entre jamais dans un calcul de marge.';
COMMENT ON TABLE affectations IS
  'Heures PRÉVUES. N''entre JAMAIS dans le calcul d''une marge — voir pointages pour le réalisé.';
