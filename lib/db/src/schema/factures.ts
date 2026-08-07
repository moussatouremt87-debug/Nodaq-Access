import { pgTable, text, timestamp, real, boolean, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const facturesTable = pgTable("factures", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  customerName: text("customer_name").notNull(),
  number: text("number").notNull(),
  issuedDate: text("issued_date").notNull(),
  dueDate: text("due_date").notNull(),
  amountCents: real("amount_cents").notNull(),
  residualCents: real("residual_cents"),
  settled: boolean("settled").notNull().default(false),
  affaireId: text("affaire_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFactureSchema = createInsertSchema(facturesTable).omit({ id: true, createdAt: true });
export type InsertFacture = z.infer<typeof insertFactureSchema>;
export type Facture = typeof facturesTable.$inferSelect;
