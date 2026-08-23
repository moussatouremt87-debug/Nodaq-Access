-- ═══════════════════════════════════════════════════════════════════════════
-- 060 — La caution à première demande, alternative à la retenue (US-B1.2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La retenue de garantie existe déjà : un pourcentage, plafonné à 5 % par la
-- loi n° 71-584 du 16/07/1971, déduit du net à payer et consigné jusqu'à sa
-- levée. Ce que la story ajoute est son ALTERNATIVE : remplacer la retenue par
-- une garantie à première demande délivrée par un établissement financier.
--
-- ── Ce que le choix change, concrètement ──────────────────────────────────
-- En mode CAUTION, le montant n'est plus déduit : le client paie l'intégralité
-- du TTC, et c'est la banque qui garantit. La trésorerie de l'artisan n'est
-- plus immobilisée — c'est tout l'intérêt, et l'impact direct sur le
-- prévisionnel (US-A3.5).
--
-- ── Substituable À TOUT MOMENT ────────────────────────────────────────────
-- La story l'exige : « l'entreprise peut le faire évoluer d'un mode à l'autre
-- à tout moment de son choix, conformément au caractère substituable de cette
-- alternative ». Un simple champ, donc, modifiable — et non une décision
-- gravée à la création du document.
ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS garantie_mode text NOT NULL DEFAULT 'RETENUE',
  ADD COLUMN IF NOT EXISTS caution_organisme text,
  ADD COLUMN IF NOT EXISTS caution_echeance date;

ALTER TABLE devis
  ADD CONSTRAINT devis_garantie_mode_connu
  CHECK (garantie_mode IN ('RETENUE', 'CAUTION'));

ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS retenue_garantie_pct real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS garantie_mode text NOT NULL DEFAULT 'RETENUE',
  ADD COLUMN IF NOT EXISTS caution_organisme text,
  ADD COLUMN IF NOT EXISTS caution_echeance date;

ALTER TABLE factures
  ADD CONSTRAINT factures_garantie_mode_connu
  CHECK (garantie_mode IN ('RETENUE', 'CAUTION'));

-- Le plafond légal est d'ORDRE PUBLIC : il ne se négocie pas, même d'un commun
-- accord. Le tenir par le moteur plutôt que par un contrôle d'écran, c'est
-- refuser une clause illégale par construction — y compris à une reprise de
-- données ou à un script de support.
--
-- ── `NOT VALID`, et pourquoi ce n'est pas un renoncement ──────────────────
-- Sans lui, `ADD CONSTRAINT` VALIDE les lignes existantes et la migration
-- ÉCHOUE si une seule d'entre elles dépasse 5 %. Sur une base vierge tout
-- passe ; sur une base réelle qui porte un devis à 10 %, la migration entière
-- avorte — et c'est en production qu'on l'apprendrait.
--
-- `NOT VALID` ne désarme pas la contrainte : toute écriture NOUVELLE est
-- refusée, exactement comme sans lui. Il dispense seulement du contrôle
-- rétroactif.
--
-- On ne corrige PAS les lignes existantes au passage. Une clause au-delà de
-- 5 % est nulle en droit, mais elle a été écrite dans un contrat signé :
-- l'écraser en silence réécrirait la mémoire d'un accord, ce qui n'est pas à
-- une migration de décider. Elles restent visibles, et se corrigent à la main.
ALTER TABLE devis
  ADD CONSTRAINT devis_retenue_plafond_legal
  CHECK (retenue_garantie_pct >= 0 AND retenue_garantie_pct <= 5) NOT VALID;

ALTER TABLE factures
  ADD CONSTRAINT factures_retenue_plafond_legal
  CHECK (retenue_garantie_pct >= 0 AND retenue_garantie_pct <= 5) NOT VALID;

COMMENT ON COLUMN factures.garantie_mode IS
  'RETENUE : le pourcentage est déduit du net à payer et consigné. CAUTION : une garantie à première demande le remplace, rien n''est déduit, et la trésorerie n''est pas immobilisée (US-B1.2). Substituable à tout moment.';

COMMENT ON CONSTRAINT factures_retenue_plafond_legal ON factures IS
  'Plafond de 5 % — loi n° 71-584 du 16/07/1971, d''ordre public. Tenu par le moteur : une clause au-delà est illégale même si les deux parties l''acceptent.';
