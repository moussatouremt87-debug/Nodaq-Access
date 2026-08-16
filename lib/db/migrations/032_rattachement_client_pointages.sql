-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 032 — rattachement direct à un client sur pointages et affectations
-- (US-A4.1 : « Pointage adapté à des métiers sans chantier »)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  HORS BÂTIMENT, IL N'Y A PAS TOUJOURS DE "CHANTIER". FORCER UN TENANT     ║
-- ║  DE SERVICE À LA PERSONNE À EN CRÉER UN FICTIF N'EST PAS UN CONTOURNEMENT ║
-- ║  ACCEPTABLE — C'EST L'INTERFACE QUI DOIT S'ADAPTER AU MÉTIER.             ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Jusqu'ici, `pointages.affaire_id` et `affectations.affaire_id` étaient
-- NOT NULL : une intervention chez un client à domicile n'avait d'autre choix
-- que de vivre sous une "affaire" — même quand rien de commercial n'existe
-- (pas de devis, pas de montant). Le vocabulaire adaptatif (`verticalPacks`)
-- change déjà le MOT affiché ("mission", "intervention"...) mais pas cette
-- structure sous-jacente.
--
-- ── POURQUOI DEUX COLONNES NULLABLES PLUTÔT QU'UNE AFFAIRE "CLIENT" ─────────
-- `clients` est déjà une entité distincte (voir 0xx_clients). Une affaire
-- "virtuelle" par client est l'anti-pattern que l'US interdit explicitement :
-- elle pollue la liste des affaires réelles et fait porter à `affaires` un
-- sens qu'elle n'a pas. Le patron déjà en place, `affaires.client_id`
-- (nullable), montre que la colonne FK nullable est la convention du dépôt
-- pour ce genre de lien optionnel — on la reproduit ici, deux fois.
--
-- ── POURQUOI UN CHECK, PAS SEULEMENT ZOD ─────────────────────────────────────
-- Un pointage sans AUCUN rattachement n'a pas de sens (il ne compterait dans
-- aucune analytique). Un pointage avec LES DEUX en même temps non plus (à
-- quelle unité imputer les heures ?). Comme pour `affectations_periode_coherente`
-- (migration 017), la garde est dans le moteur : une reprise de données ou un
-- script ne passent pas par la validation Zod de la route.
--
-- ── POURQUOI DEUX INDEX UNIQUES PARTIELS, PAS UN UNIQUE COMPOSITE ────────────
-- NULL n'est jamais égal à NULL en SQL : un UNIQUE classique sur
-- (tenant_id, membre_id, affaire_id, client_id, date) laisserait passer un
-- nombre illimité de pointages "affaire_id=X, client_id=NULL" tant que leurs
-- autres colonnes varient... mais surtout, il ne bloquerait JAMAIS deux
-- pointages "affaire_id=NULL, client_id=Y" pour le même membre le même jour,
-- puisque chaque NULL compte comme distinct. Deux index PARTIELS — un par
-- rattachement — retrouvent l'unicité voulue de chaque côté.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── pointages ────────────────────────────────────────────────────────────────

ALTER TABLE pointages ALTER COLUMN affaire_id DROP NOT NULL;
ALTER TABLE pointages ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE pointages ADD CONSTRAINT pointages_rattachement_exclusif
  CHECK ((affaire_id IS NOT NULL)::int + (client_id IS NOT NULL)::int = 1);

ALTER TABLE pointages DROP CONSTRAINT pointages_unique_membre_affaire_jour;

CREATE UNIQUE INDEX IF NOT EXISTS pointages_unique_membre_affaire_jour
  ON pointages (tenant_id, membre_id, affaire_id, date)
  WHERE affaire_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pointages_unique_membre_client_jour
  ON pointages (tenant_id, membre_id, client_id, date)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pointages_tenant_client_idx ON pointages (tenant_id, client_id);

-- ── affectations ─────────────────────────────────────────────────────────────
-- (affaire_id n'a jamais porté de FK déclarée ici — pré-existant, non traité
-- par cette migration. client_id, nouvelle colonne, en porte une dès sa
-- création.)

ALTER TABLE affectations ALTER COLUMN affaire_id DROP NOT NULL;
ALTER TABLE affectations ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE affectations ADD CONSTRAINT affectations_rattachement_exclusif
  CHECK ((affaire_id IS NOT NULL)::int + (client_id IS NOT NULL)::int = 1);

CREATE INDEX IF NOT EXISTS affectations_tenant_client_idx ON affectations (tenant_id, client_id);
