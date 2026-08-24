-- Migration 065 — grille tarifaire (décision fondateur, août 2026)
--
-- Pose le MODÈLE de l'abonnement nodaq : les plans, l'abonnement de chaque
-- tenant, la jauge globale de l'offre Fondateurs et les franchissements de
-- seuil d'usage vocal. L'encaissement (Stripe Billing) est un ticket séparé —
-- rien ici ne parle à un prestataire de paiement.
--
-- ── Les prix vivent ICI et nulle part ailleurs ─────────────────────────────
-- La grille interdit de coder un prix hors du seed des plans. Les montants
-- sont en centimes INTEGER (migration 056 : jamais de flottant, jamais de
-- bigint — node-postgres rend int8 en chaîne). Le dépassement d'appel vocal
-- est à 60 centimes : le millicentime d'`appels_relance.cout_millicents`
-- reste le COÛT fournisseur, pas le prix facturé.
--
-- ── Pourquoi `fondateurs_compteur` est GLOBALE (sans tenant_id) ───────────
-- L'offre Fondateurs est limitée à 50 tenants. Sous FORCE RLS, un tenant ne
-- voit que ses propres lignes : compter les abonnements Fondateurs à travers
-- les tenants est impossible depuis `app_user`. La jauge est donc une table
-- globale à une ligne, réclamée par UPDATE conditionnel atomique — le 51e
-- échoue, il n'y a pas de fenêtre de course. Même statut hors-RLS que
-- `plans` : ni l'une ni l'autre ne porte de donnée d'un tenant.

CREATE TABLE IF NOT EXISTS plans (
  id                          TEXT        PRIMARY KEY,
  libelle                     TEXT        NOT NULL,
  prix_mensuel_cents          INTEGER     NOT NULL CHECK (prix_mensuel_cents >= 0),
  -- NULL = pas d'engagement annuel proposé (Fondateurs : le prix est déjà
  -- garanti à vie, la grille ne définit pas d'annuel pour ce plan).
  prix_annuel_cents           INTEGER              CHECK (prix_annuel_cents >= 0),
  utilisateurs_inclus         INTEGER     NOT NULL DEFAULT 1,
  -- NULL = pas d'utilisateur supplémentaire possible (Solo).
  prix_utilisateur_supp_cents INTEGER              CHECK (prix_utilisateur_supp_cents >= 0),
  -- Module vocal uniquement : appels inclus par mois calendaire, puis prix
  -- unitaire du dépassement. 0/NULL pour les plans de base.
  appels_inclus               INTEGER     NOT NULL DEFAULT 0,
  prix_appel_supp_cents       INTEGER              CHECK (prix_appel_supp_cents >= 0)
);

-- Seed : LA source des prix. Une évolution de grille = une nouvelle migration.
INSERT INTO plans (id, libelle, prix_mensuel_cents, prix_annuel_cents,
                   utilisateurs_inclus, prix_utilisateur_supp_cents,
                   appels_inclus, prix_appel_supp_cents)
VALUES
  -- Fondateurs : tout Équipe, 29 €/mois garanti à vie, réservé aux 50 premiers.
  ('fondateurs',   'Fondateurs',            2900,  NULL, 5, 1500, 0, NULL),
  ('solo',         'Solo',                  4900,  49000, 1, NULL, 0, NULL),
  ('equipe',       'Équipe',                8900,  89000, 5, 1500, 0, NULL),
  -- Module optionnel, cumulable avec n'importe quel plan de base.
  ('module_vocal', 'Relance vocale',        1900,  19000, 0, NULL, 30, 60)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       TEXT        PRIMARY KEY,
  tenant_id                UUID        NOT NULL REFERENCES tenants(id),
  plan_id                  TEXT        NOT NULL REFERENCES plans(id),

  -- TRIAL : essai 14 jours, toutes fonctionnalités, limites Équipe.
  -- READONLY : essai échu sans souscription — lecture seule, JAMAIS de
  -- suppression de données. La bascule est paresseuse (constatée à la
  -- lecture), il n'y a pas de tâche planifiée à entretenir.
  statut                   TEXT        NOT NULL DEFAULT 'TRIAL'
                             CHECK (statut IN ('TRIAL','ACTIVE','READONLY')),
  periodicite              TEXT        NOT NULL DEFAULT 'MENSUEL'
                             CHECK (periodicite IN ('MENSUEL','ANNUEL')),

  trial_ends_at            TIMESTAMPTZ,
  -- « Garanti à vie » matérialisé : posé à la souscription Fondateurs, jamais
  -- effacé tant que l'abonnement reste actif.
  price_locked_at          TIMESTAMPTZ,

  -- Retour vers une formule moindre : il prend effet à l'échéance, jamais en
  -- cours de période. `plan_suivant` porte la cible, `echeance` la date.
  plan_suivant             TEXT        REFERENCES plans(id),
  echeance                 TIMESTAMPTZ,

  -- Le module vocal reste inactif par défaut (décision souveraineté :
  -- l'activer, c'est accepter le module ET son tarif — la date en témoigne).
  module_vocal             BOOLEAN     NOT NULL DEFAULT FALSE,
  module_vocal_depuis      TIMESTAMPTZ,

  -- Dérogation manuelle par tenant (admin fondateur) — la grille interdit
  -- toute remise codée en dur ; celle-ci est une donnée, pas du code.
  derogation_remise_cents  INTEGER     CHECK (derogation_remise_cents >= 0),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Un abonnement par tenant : l'état courant est ici, l'HISTORIQUE des
  -- changements est dans journal_decisions (immuable), pas dans cette table.
  CONSTRAINT subscriptions_un_par_tenant UNIQUE (tenant_id)
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON subscriptions;
CREATE POLICY tenant_isolation ON subscriptions
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Jauge globale Fondateurs : une seule ligne, réclamée atomiquement.
CREATE TABLE IF NOT EXISTS fondateurs_compteur (
  id             TEXT        PRIMARY KEY,
  places_totales INTEGER     NOT NULL,
  places_prises  INTEGER     NOT NULL DEFAULT 0
                   CHECK (places_prises >= 0 AND places_prises <= places_totales),
  -- Fermeture manuelle anticipée par le fondateur, indépendante du compteur.
  ferme_le       TIMESTAMPTZ
);

INSERT INTO fondateurs_compteur (id, places_totales, places_prises)
VALUES ('global', 50, 0)
ON CONFLICT (id) DO NOTHING;

-- Franchissements de seuil d'usage vocal (« 80 % des appels inclus ») :
-- append-only, une ligne par (tenant, mois, seuil) — c'est ce qui garantit
-- qu'une alerte ne part qu'UNE fois par mois, même relue en concurrence.
-- Même motif que objectifs_franchissements (migration 011). Le compteur
-- lui-même n'a pas de table : il se DÉRIVE d'appels_relance (started_at,
-- mois calendaire Europe/Paris) — un compteur redondant finirait par mentir.
CREATE TABLE IF NOT EXISTS usage_franchissements (
  id         TEXT        PRIMARY KEY,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id),
  -- 'YYYY-MM' en heure de Paris : le mois COMMERCIAL d'un produit français.
  mois       TEXT        NOT NULL,
  seuil_pct  INTEGER     NOT NULL CHECK (seuil_pct > 0 AND seuil_pct <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT usage_franchissements_unique UNIQUE (tenant_id, mois, seuil_pct)
);

ALTER TABLE usage_franchissements ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_franchissements FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON usage_franchissements;
CREATE POLICY tenant_isolation ON usage_franchissements
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Backfill : les tenants existants entrent en essai 14 jours (limites
-- Équipe), comme un tenant neuf. Aucun n'a jamais souscrit : leur donner
-- ACTIVE inventerait un consentement tarifaire que personne n'a donné.
INSERT INTO subscriptions (id, tenant_id, plan_id, statut, trial_ends_at)
SELECT gen_random_uuid()::text, t.id, 'equipe', 'TRIAL', NOW() + INTERVAL '14 days'
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);
