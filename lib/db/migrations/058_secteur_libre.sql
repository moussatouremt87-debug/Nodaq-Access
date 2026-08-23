-- ═══════════════════════════════════════════════════════════════════════════
-- 058 — Le métier de ceux dont le secteur n'est pas dans la liste (US-A1.4)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- L'audit du 23/08/2026 a constaté que l'onboarding ne propose que NEUF
-- secteurs, sans porte de sortie. Un fleuriste, un agriculteur, un
-- photographe n'y trouve pas son métier : il en choisit un autre, ou passe
-- l'écran — et le défaut serveur le range alors en `industrie_btp`.
--
-- Le rebond que US-A1.1 corrige à l'écran du secteur revenait donc à l'écran
-- suivant, sous une autre forme.
--
-- Cette colonne porte le métier DIT PAR L'UTILISATEUR quand aucun de la liste
-- ne convient. Le critère d'acceptation 3 de la story l'exige explicitement :
-- « quand plusieurs utilisateurs le signalent, alors cette donnée remonte de
-- façon exploitable côté produit » — donc un champ interrogeable, et non un
-- message statique qui ne laisserait aucune trace.
--
-- Elle vit dans `onboarding_qualification` plutôt que dans une table à elle :
-- c'est une réponse d'onboarding de plus, elle hérite de la RLS et du test
-- d'isolation existants, et une table dédiée pour une colonne serait une
-- cérémonie sans objet.
ALTER TABLE onboarding_qualification
  ADD COLUMN IF NOT EXISTS secteur_libre text;

COMMENT ON COLUMN onboarding_qualification.secteur_libre IS
  'Le métier tel que l''utilisateur l''écrit, quand aucun secteur de la liste ne convient (US-A1.4). Sert à choisir le prochain module sectoriel à construire — pas à configurer le compte, qui reste sur le pack neutre « autre ».';
