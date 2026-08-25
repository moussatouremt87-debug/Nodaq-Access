-- Migration 065 — grille tarifaire (décision fondateur, août 2026,
-- corrigée par le ticket 4.43 avant toute livraison)
--
-- Pose le MODÈLE de l'abonnement nodaq : les plans, l'abonnement de chaque
-- tenant, la jauge globale de l'offre Fondateurs, les franchissements de
-- seuil d'usage et les jalons d'essai. L'encaissement (Stripe Billing) est
-- un ticket séparé — rien ici ne parle à un prestataire de paiement.
--
-- ── Les prix vivent ICI et nulle part ailleurs ─────────────────────────────
-- La grille interdit de coder un prix hors du seed des plans. Les montants
-- sont en centimes INTEGER (migration 056 : jamais de flottant, jamais de
-- bigint — node-postgres rend int8 en chaîne).
--
-- ── L'usage vocal se compte en DOSSIERS, jamais en tentatives (4.43) ──────
-- Un dossier = un impayé relancé dans le mois calendaire, quel que soit le
-- nombre de tentatives d'appel (injoignable, répondeur, rappels). Un artisan
-- pense en clients à relancer, pas en appels téléphoniques — et compter les
-- tentatives punirait précisément les débiteurs injoignables. Le millicentime
-- d'`appels_relance.cout_millicents` reste le COÛT fournisseur par tentative,
-- pas le prix facturé.
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
  -- Module vocal uniquement : dossiers de relance inclus par mois calendaire
  -- (un dossier = un impayé relancé, pas une tentative), puis prix unitaire
  -- du dossier supplémentaire. 0/NULL pour les plans de base.
  dossiers_inclus             INTEGER     NOT NULL DEFAULT 0,
  prix_dossier_supp_cents     INTEGER              CHECK (prix_dossier_supp_cents >= 0),
  -- Plafond souple WhatsApp (4.43) : conversations de relance incluses par
  -- mois. Au-delà : alerte, JAMAIS de blocage en v1 — le plafond protège de
  -- l'abus (l'API WhatsApp Business est facturée à la conversation), aucun
  -- client honnête ne l'atteindra. L'e-mail, à coût marginal nul, reste le
  -- seul canal réellement illimité.
  whatsapp_conversations_incluses INTEGER NOT NULL DEFAULT 0
);

-- Seed : LA source des prix. Une évolution de grille = une nouvelle migration.
INSERT INTO plans (id, libelle, prix_mensuel_cents, prix_annuel_cents,
                   utilisateurs_inclus, prix_utilisateur_supp_cents,
                   dossiers_inclus, prix_dossier_supp_cents,
                   whatsapp_conversations_incluses)
VALUES
  -- Fondateurs : tout Équipe, 29 €/mois garanti à vie, réservé aux 50
  -- premiers. Seul le prix de BASE est verrouillé : les sièges au-delà de 5
  -- (15 €) et le module vocal restent facturés comme partout (4.43 §4).
  ('fondateurs',   'Fondateurs',     2900,  NULL, 5, 1500, 0, NULL, 200),
  ('solo',         'Solo',           4900,  49000, 1, NULL, 0, NULL, 200),
  ('equipe',       'Équipe',         8900,  89000, 5, 1500, 0, NULL, 200),
  -- Module optionnel, cumulable avec n'importe quel plan de base.
  ('module_vocal', 'Relance vocale', 1900,  19000, 0, NULL, 10, 200, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       TEXT        PRIMARY KEY,
  tenant_id                UUID        NOT NULL REFERENCES tenants(id),
  plan_id                  TEXT        NOT NULL REFERENCES plans(id),

  -- TRIAL : essai 14 jours, toutes fonctionnalités, limites Équipe, sans
  -- carte bancaire (elle n'est demandée qu'au jour 10 — voir essai_jalons).
  -- READONLY : essai échu sans souscription — lecture seule, JAMAIS de
  -- suppression de données. La bascule est paresseuse (constatée à la
  -- lecture), il n'y a pas de tâche planifiée à entretenir.
  statut                   TEXT        NOT NULL DEFAULT 'TRIAL'
                             CHECK (statut IN ('TRIAL','ACTIVE','READONLY')),
  periodicite              TEXT        NOT NULL DEFAULT 'MENSUEL'
                             CHECK (periodicite IN ('MENSUEL','ANNUEL')),

  trial_ends_at            TIMESTAMPTZ,
  -- « Garanti à vie » matérialisé : posé à la souscription Fondateurs, jamais
  -- effacé tant que l'abonnement reste actif. Ne couvre QUE le prix de base.
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

-- Franchissements de seuil d'usage (« 80 % des dossiers inclus », « plafond
-- WhatsApp atteint ») : append-only, une ligne par (tenant, usage, mois,
-- seuil) — c'est ce qui garantit qu'une alerte ne part qu'UNE fois par mois,
-- même relue en concurrence. Même motif que objectifs_franchissements
-- (migration 011). Les compteurs eux-mêmes n'ont pas de table : ils se
-- DÉRIVENT des tables qui font foi (appels_relance pour le vocal — dossiers
-- distincts par mois calendaire Europe/Paris) — un compteur redondant
-- finirait par mentir.
CREATE TABLE IF NOT EXISTS usage_franchissements (
  id         TEXT        PRIMARY KEY,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id),
  usage      TEXT        NOT NULL DEFAULT 'vocal'
               CHECK (usage IN ('vocal','whatsapp')),
  -- 'YYYY-MM' en heure de Paris : le mois COMMERCIAL d'un produit français.
  mois       TEXT        NOT NULL,
  seuil_pct  INTEGER     NOT NULL CHECK (seuil_pct > 0 AND seuil_pct <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT usage_franchissements_unique UNIQUE (tenant_id, usage, mois, seuil_pct)
);

ALTER TABLE usage_franchissements ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_franchissements FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON usage_franchissements;
CREATE POLICY tenant_isolation ON usage_franchissements
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Jalons d'essai (4.43 §5) : J7 = e-mail d'activation si aucune action
-- validée, J10 = demande de carte (bandeau + e-mail, message de continuité).
-- Append-only et UNIQUE (tenant, jalon) : chaque jalon ne se constate et ne
-- s'annonce qu'UNE fois, même relu en concurrence — la même mécanique que
-- les franchissements d'usage. Interdit structurel : pas de jalon carte
-- avant J10 (la garde vit dans le code qui constate, testée).
CREATE TABLE IF NOT EXISTS essai_jalons (
  id         TEXT        PRIMARY KEY,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id),
  jalon      TEXT        NOT NULL CHECK (jalon IN ('J7_ACTIVATION','J10_CARTE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT essai_jalons_unique UNIQUE (tenant_id, jalon)
);

ALTER TABLE essai_jalons ENABLE ROW LEVEL SECURITY;
ALTER TABLE essai_jalons FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON essai_jalons;
CREATE POLICY tenant_isolation ON essai_jalons
  USING      (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- Backfill : les tenants existants entrent en essai 14 jours (limites
-- Équipe), comme un tenant neuf. Aucun n'a jamais souscrit : leur donner
-- ACTIVE inventerait un consentement tarifaire que personne n'a donné.
INSERT INTO subscriptions (id, tenant_id, plan_id, statut, trial_ends_at)
SELECT gen_random_uuid()::text, t.id, 'equipe', 'TRIAL', NOW() + INTERVAL '14 days'
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);
