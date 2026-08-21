-- Migration 049 — la facture issue d'un devis (ticket 4.21)
--
-- Jusqu'ici, rien ne reliait une facture au devis qu'elle facture : la
-- conversion n'existait que vers une AFFAIRE (`devis.affaire_id`). Facturer un
-- devis deux fois n'était donc pas seulement possible, c'était invisible — deux
-- factures au même client, pour le même chantier, sans rien qui le signale.
--
-- ── Pourquoi l'unicité est portée par le MOTEUR ───────────────────────────
-- Un contrôle applicatif « ce devis a-t-il déjà une facture ? » se contourne
-- par deux requêtes simultanées : les deux lisent « non », les deux écrivent.
-- L'index unique tranche, quel que soit le chemin — route, voix, ou reprise de
-- données.
--
-- NULLABLE : l'immense majorité des factures ne vient d'aucun devis, et
-- l'index partiel ne contraint que celles qui en ont un.

ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS devis_id TEXT REFERENCES devis(id);

CREATE UNIQUE INDEX IF NOT EXISTS factures_devis_unique_idx
  ON factures (devis_id) WHERE devis_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS factures_tenant_devis_idx
  ON factures (tenant_id, devis_id);
