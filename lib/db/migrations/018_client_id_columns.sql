-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 018 — rattachement des documents à une fiche client
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  LE TEXTE EST UN INSTANTANÉ, `client_id` EST LE LIEN.                     ║
-- ║                                                                           ║
-- ║  Les colonnes de nom existantes — `client_name`, `customer_name` — NE     ║
-- ║  SONT PAS SUPPRIMÉES, et ne doivent jamais être remplacées par une        ║
-- ║  jointure.                                                                ║
-- ║                                                                           ║
-- ║  Sur un document ÉMIS, le nom doit rester figé tel qu'il a été imprimé.   ║
-- ║  Une facture émise à « Dupont SARL » ne doit pas se mettre à afficher     ║
-- ║  « Dupont & Fils » parce que la fiche a été renommée depuis : le PDF      ║
-- ║  archivé, lui, porte toujours l'ancien nom, et une facture dont l'écran   ║
-- ║  contredit le PDF n'est plus une preuve.                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- La colonne est NULLABLE : tout l'existant a été saisi sans fiche client, et
-- rien n'autorise à deviner à quel Dupont se rattache une facture de 2024.
-- Le rattachement se fait à la saisie suivante, ou à la main.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE affaires  ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE devis     ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE factures  ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS client_id TEXT;

-- Clés étrangères ajoutées séparément et de façon idempotente : `ADD
-- CONSTRAINT` n'a pas de `IF NOT EXISTS` en PostgreSQL 16.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['affaires', 'devis', 'factures', 'prospects'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = format('%s_client_id_fkey', t)
         AND conrelid = format('public.%I', t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (client_id) REFERENCES clients(id)',
        t, format('%s_client_id_fkey', t)
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS affaires_client_idx  ON affaires  (tenant_id, client_id);
CREATE INDEX IF NOT EXISTS devis_client_idx     ON devis     (tenant_id, client_id);
CREATE INDEX IF NOT EXISTS factures_client_idx  ON factures  (tenant_id, client_id);
CREATE INDEX IF NOT EXISTS prospects_client_idx ON prospects (tenant_id, client_id);
