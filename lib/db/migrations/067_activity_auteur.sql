-- QUI a fait quoi.
--
-- `activity` ne portait que `type`, `label`, `meta`, `created_at`. L'écran
-- « Activité récente » affichait donc « Nouvelle affaire : réfection toiture »
-- sans jamais dire par qui — un patron ne pouvait pas savoir que sa secrétaire
-- avait fait un devis ou qu'un salarié avait modifié le planning.
--
-- Signalé par le fondateur le 29/08/2026 : « le propriétaire principal doit
-- avoir si un employé update le planning ou si la secrétaire fait un devis ».
--
-- `journal_decisions`, lui, portait DÉJÀ `decidee_par` : la traçabilité des
-- VALIDATIONS existait, c'est celle des actions courantes qui manquait.
--
-- ── NULLABLE, ET C'EST PORTEUR DE SENS ──────────────────────────────────────
-- Une activité sans auteur n'est pas une donnée manquante : c'est le SYSTÈME
-- qui a agi — un renouvellement d'abonnement, un objectif franchi, une relance
-- exécutée. Rendre la colonne obligatoire aurait forcé à inventer un auteur
-- pour ces lignes, et l'écran aurait affiché un nom là où personne n'a rien
-- fait.
--
-- Le NOM est copié à côté de l'identifiant, délibérément. Un membre qui quitte
-- l'entreprise ne doit pas effacer l'historique de ce qu'il a fait : la
-- jointure rendrait alors « (inconnu) » sur des mois d'activité.
ALTER TABLE activity
  ADD COLUMN IF NOT EXISTS auteur_user_id uuid,
  ADD COLUMN IF NOT EXISTS auteur_nom     text;

COMMENT ON COLUMN activity.auteur_user_id IS
  'Qui a déclenché cette activité. NULL = le système (abonnement, objectif, relance automatique).';
COMMENT ON COLUMN activity.auteur_nom IS
  'Nom au moment des faits, copié volontairement : un départ ne doit pas effacer l''historique.';
