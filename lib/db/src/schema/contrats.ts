import { pgTable, text, timestamp, real, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const contratsTable = pgTable("contrats", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  label: text("label").notNull(),
  clientName: text("client_name"),
  cadence: text("cadence").notNull().default("mensuel"),
  amountCents: real("amount_cents"),
  status: text("status").notNull().default("ACTIF"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  notes: text("notes"),
  nextOccurrenceDate: text("next_occurrence_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertContratSchema = createInsertSchema(contratsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContrat = z.infer<typeof insertContratSchema>;
export type Contrat = typeof contratsTable.$inferSelect;
