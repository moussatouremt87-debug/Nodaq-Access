import { pgTable, text, timestamp, uuid, boolean, integer, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Grille tarifaire (décision fondateur, août 2026, corrigée 4.43) —
 * migration 065.
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
  /** Module vocal : DOSSIERS de relance inclus par mois — un dossier = un
   *  impayé relancé, jamais une tentative d'appel (4.43 §1). */
  dossiersInclus: integer("dossiers_inclus").notNull().default(0),
  prixDossierSuppCents: integer("prix_dossier_supp_cents"),
  /** Plafond souple : au-delà on alerte, on ne bloque jamais (4.43 §2). */
  whatsappConversationsIncluses: integer("whatsapp_conversations_incluses").notNull().default(0),
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
    /** « Garanti à vie » matérialisé — posé à la souscription Fondateurs.
     *  Ne couvre QUE le prix de base : les sièges au-delà de 5 et le module
     *  vocal restent facturés comme partout (4.43 §4). */
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
 * Franchissements de seuil d'usage — append-only, UNIQUE (tenant, usage,
 * mois, seuil) : chaque alerte (« 80 % des dossiers », « plafond WhatsApp »)
 * ne part qu'une fois par mois, même constatée en concurrence. Les compteurs
 * se DÉRIVENT des tables qui font foi (appels_relance : dossiers distincts
 * par mois calendaire Europe/Paris).
 */
export const usageFranchissementsTable = pgTable(
  "usage_franchissements",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    usage: text("usage", { enum: ["vocal", "whatsapp"] }).notNull().default("vocal"),
    /** 'YYYY-MM' en heure de Paris — le mois commercial d'un produit français. */
    mois: text("mois").notNull(),
    seuilPct: integer("seuil_pct").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("usage_franchissements_unique").on(t.tenantId, t.usage, t.mois, t.seuilPct)],
);

/**
 * Jalons d'essai (4.43 §5) — append-only, UNIQUE (tenant, jalon) : le
 * bandeau carte de J10 et l'e-mail d'activation de J7 ne se constatent et
 * ne partent qu'une fois. Le J10 est un message de continuité, jamais une
 * menace ; avant J10, il est interdit de demander la carte.
 */
export const essaiJalonsTable = pgTable(
  "essai_jalons",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    jalon: text("jalon", { enum: ["J7_ACTIVATION", "J10_CARTE"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("essai_jalons_unique").on(t.tenantId, t.jalon)],
);

export type Plan = typeof plansTable.$inferSelect;
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type UsageFranchissement = typeof usageFranchissementsTable.$inferSelect;
export type EssaiJalon = typeof essaiJalonsTable.$inferSelect;
