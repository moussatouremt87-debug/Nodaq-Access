import { pgTable, text, timestamp, uuid, integer, jsonb, index } from "drizzle-orm/pg-core";
import type { MandatCampagne } from "@nodaq/shared";
import { tenantsTable } from "./tenants";

/** Un appel proposé dans une campagne (ticket 4.18, US-1). */
export interface AppelPropose {
  readonly clientId: string | null;
  readonly factureId: string;
  readonly montantCents: number;
  readonly numero: string;
  readonly clientNom: string;
}

/**
 * Campagne de relance vocale (ticket 4.18, US-1).
 *
 * Reliée à sa `pending_action` par `pendingActionId`, SANS clé étrangère : la
 * file de validation est purgeable (voir 040), la campagne doit lui survivre —
 * c'est elle qui portera les appels passés, leurs issues et leurs coûts.
 *
 * `mandat` porte la demande avant validation, et le mandat EFFECTIF après —
 * recalculé contre la règle en vigueur puis gelé, avec `regleVersion`. C'est ce
 * couple qui permet de relire une campagne des mois plus tard et de savoir ce
 * que l'agent avait le droit d'accorder ce jour-là.
 */
export const campagnesRelanceTable = pgTable(
  "campagnes_relance",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    pendingActionId: text("pending_action_id").notNull(),

    statut: text("statut").notNull().default("PROPOSEE"),
    appels: jsonb("appels").$type<AppelPropose[]>().notNull().default([]),

    // Typé avec le vrai type plutôt qu'un `Record` fourre-tout : c'est ce
    // qui fait échouer la compilation si le mandat gelé cesse d'avoir la même
    // forme que la règle — la comparaison champ à champ en dépend.
    mandat: jsonb("mandat").$type<MandatCampagne>().notNull(),
    /** NULL tant que la campagne n'est pas validée : aucune version ne s'applique. */
    regleVersion: integer("regle_version"),

    fenetreDebutHeure: integer("fenetre_debut_heure").notNull().default(9),
    fenetreFinHeure: integer("fenetre_fin_heure").notNull().default(18),
    maxTentatives: integer("max_tentatives").notNull().default(3),

    valideeParEmail: text("validee_par_email"),
    valideeLe: timestamp("validee_le", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("campagnes_relance_tenant_statut_idx").on(t.tenantId, t.statut, t.createdAt),
    index("campagnes_relance_action_idx").on(t.pendingActionId),
  ],
);

export type CampagneRelance = typeof campagnesRelanceTable.$inferSelect;
