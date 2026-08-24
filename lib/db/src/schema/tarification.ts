import { pgTable, text, timestamp, uuid, boolean, integer, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Grille tarifaire (décision fondateur, août 2026) — migration 065.
 *
 * `plans` et `fondateurs_compteur` sont GLOBALES (pas de tenant_id, pas de
 * RLS) : un référentiel de prix et une jauge de 50 places ne portent la
 * donnée d'aucun tenant, et sous FORCE RLS un tenant ne pourrait de toute
 * façon pas compter les abonnements des autres.
 *
 * Les prix vivent dans le SEED de la migration, en centimes INTEGER —
 * la grille interdit d'en coder ailleurs.
 */
export const plansTable = pgTable("plans", {
  id: text("id").primaryKey(),
  libelle: text("libelle").notNull(),
  prixMensuelCents: integer("prix_mensuel_cents").notNull(),
  /** NULL = pas d'engagement annuel proposé (Fondateurs). */
  prixAnnuelCents: integer("prix_annuel_cents"),
  utilisateursInclus: integer("utilisateurs_inclus").notNull().default(1),
  /** NULL = pas d'utilisateur supplémentaire possible (Solo). */
  prixUtilisateurSuppCents: integer("prix_utilisateur_supp_cents"),
  appelsInclus: integer("appels_inclus").notNull().default(0),
  prixAppelSuppCents: integer("prix_appel_supp_cents"),
});

/**
 * L'abonnement d'un tenant — UNE ligne par tenant : l'état courant est ici,
 * l'historique des changements est dans `journal_decisions` (immuable).
 *
 * READONLY (essai échu) est constaté paresseusement à la lecture — pas de
 * tâche planifiée. La lecture seule ne supprime JAMAIS de données.
 */
export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    planId: text("plan_id").notNull().references(() => plansTable.id),

    statut: text("statut", { enum: ["TRIAL", "ACTIVE", "READONLY"] })
      .notNull()
      .default("TRIAL"),
    periodicite: text("periodicite", { enum: ["MENSUEL", "ANNUEL"] })
      .notNull()
      .default("MENSUEL"),

    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** « Garanti à vie » matérialisé — posé à la souscription Fondateurs. */
    priceLockedAt: timestamp("price_locked_at", { withTimezone: true }),

    /** Retour vers une formule moindre : cible et date d'effet (l'échéance). */
    planSuivant: text("plan_suivant").references(() => plansTable.id),
    echeance: timestamp("echeance", { withTimezone: true }),

    /** Inactif par défaut : l'activer = accepter le module ET son tarif. */
    moduleVocal: boolean("module_vocal").notNull().default(false),
    moduleVocalDepuis: timestamp("module_vocal_depuis", { withTimezone: true }),

    /** Dérogation manuelle par tenant — une donnée, jamais du code. */
    derogationRemiseCents: integer("derogation_remise_cents"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("subscriptions_un_par_tenant").on(t.tenantId)],
);

/** Jauge globale de l'offre Fondateurs : une ligne `global`, claim atomique. */
export const fondateursCompteurTable = pgTable("fondateurs_compteur", {
  id: text("id").primaryKey(),
  placesTotales: integer("places_totales").notNull(),
  placesPrises: integer("places_prises").notNull().default(0),
  fermeLe: timestamp("ferme_le", { withTimezone: true }),
});

/**
 * Franchissements de seuil d'usage vocal — append-only, UNIQUE
 * (tenant, mois, seuil) : l'alerte « 80 % des appels inclus » ne part qu'une
 * fois par mois, même constatée en concurrence. Le compteur lui-même se
 * dérive d'`appels_relance` (started_at, mois calendaire Europe/Paris).
 */
export const usageFranchissementsTable = pgTable(
  "usage_franchissements",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    /** 'YYYY-MM' en heure de Paris — le mois commercial d'un produit français. */
    mois: text("mois").notNull(),
    seuilPct: integer("seuil_pct").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("usage_franchissements_unique").on(t.tenantId, t.mois, t.seuilPct)],
);

export type Plan = typeof plansTable.$inferSelect;
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type UsageFranchissement = typeof usageFranchissementsTable.$inferSelect;
