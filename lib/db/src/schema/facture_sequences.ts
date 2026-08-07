import { pgTable, integer, uuid, primaryKey } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Sequential invoice counter per tenant per year.
 * The sequence is incremented inside a SELECT FOR UPDATE transaction to guarantee
 * no gaps and no duplicates even under concurrent emissions.
 */
export const factureSequencesTable = pgTable("facture_sequences", {
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  year: integer("year").notNull(),
  /** Last assigned sequence number (0 = none yet). */
  seq: integer("seq").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.year] }),
]);

export type FactureSequence = typeof factureSequencesTable.$inferSelect;
