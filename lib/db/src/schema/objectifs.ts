import { pgTable, text, integer, timestamp, uuid, index, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Franchissements d'objectifs — append-only, une ligne par (tenant, objectif,
 * exercice).
 *
 * C'est la contrainte d'unicité qui porte l'idempotence : un avoir qui fait
 * repasser sous le seuil puis une nouvelle facture qui repasse au-dessus ne
 * produisent pas un second franchissement. Ce n'est pas au code de s'en
 * souvenir, c'est au moteur de refuser.
 */
export const objectifsFranchissementsTable = pgTable(
  "objectifs_franchissements",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    /** 'exercice_precedent' | 'seuil_rentabilite'. */
    objectif: text("objectif").notNull(),
    /** Année civile — la bascule d'exercice repart de zéro. */
    exercice: integer("exercice").notNull(),
    montantCents: integer("montant_cents").notNull(),
    franchiLe: timestamp("franchi_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("objectifs_franchissements_unique").on(t.tenantId, t.objectif, t.exercice),
    index("objectifs_franchissements_tenant_exercice_idx").on(t.tenantId, t.exercice),
  ],
);

export type ObjectifFranchissement = typeof objectifsFranchissementsTable.$inferSelect;

export const OBJECTIFS = ["exercice_precedent", "seuil_rentabilite"] as const;
export type ObjectifId = (typeof OBJECTIFS)[number];
