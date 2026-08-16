import { pgTable, text, timestamp, integer, boolean, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const chargesRecurrentesTable = pgTable("charges_recurrentes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  label: text("label").notNull(),
  category: text("category").notNull(), // LOYER, MASSE_SALARIALE, ABONNEMENT, ASSURANCE, AUTRE
  cadence: text("cadence").notNull(), // mensuel, trimestriel, semestriel, annuel
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  amountCents: integer("amount_cents").notNull(),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChargeRecurrenteSchema = createInsertSchema(chargesRecurrentesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChargeRecurrente = z.infer<typeof insertChargeRecurrenteSchema>;
export type ChargeRecurrente = typeof chargesRecurrentesTable.$inferSelect;
