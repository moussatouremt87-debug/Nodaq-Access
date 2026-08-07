import { pgTable, text, timestamp, real, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const affairesTable = pgTable("affaires", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  reference: text("reference"),
  label: text("label").notNull(),
  clientName: text("client_name"),
  status: text("status").notNull().default("PROSPECT"),
  quotedAmountCents: real("quoted_amount_cents"),
  invoicedAmountCents: real("invoiced_amount_cents"),
  marginCents: real("margin_cents"),
  notes: text("notes"),
  startDate: text("start_date"),
  completedAt: text("completed_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAffaireSchema = createInsertSchema(affairesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAffaire = z.infer<typeof insertAffaireSchema>;
export type Affaire = typeof affairesTable.$inferSelect;
