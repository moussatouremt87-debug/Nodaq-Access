-- ═══════════════════════════════════════════════════════════════════════════
-- 063 — Distinguer une aide versée par un tiers (US-B4.1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- L'attestation fiscale SAP porte sur ce que le CLIENT a déboursé. Les sommes
-- versées par un tiers — APA, PCH, CESU préfinancé par un employeur — sont
-- encaissées par l'entreprise mais ne sortent pas de la poche du client : elles
-- n'ouvrent aucun droit au crédit d'impôt, et les compter gonflerait
-- l'avantage fiscal déclaré. C'est le client que l'administration
-- redresserait, pas le prestataire.
--
-- Une seule valeur plutôt qu'une par dispositif : APA, PCH et CESU préfinancé
-- reçoivent le même traitement fiscal, et trois valeurs demanderaient à
-- l'utilisateur une distinction qui ne change rien au calcul.
--
-- L'élargissement d'un CHECK est sûr : toutes les lignes existantes le
-- satisfont déjà, donc la validation à l'ajout ne peut pas échouer.
ALTER TABLE paiements DROP CONSTRAINT IF EXISTS paiements_nature_check;
ALTER TABLE paiements ADD CONSTRAINT paiements_nature_check
  CHECK (nature IN ('ACOMPTE', 'SITUATION', 'SOLDE', 'AIDE_TIERS', 'AUTRE'));

COMMENT ON COLUMN paiements.nature IS
  'Nature de l''encaissement. AIDE_TIERS = versé par un organisme (APA, PCH, CESU préfinancé) et non par le client : exclu de l''assiette du crédit d''impôt de l''attestation SAP (US-B4.1).';
