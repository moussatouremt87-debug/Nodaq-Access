import { pgTable, text, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const echeancesTable = pgTable("echeances", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text("type").notNull(), // TVA, IS, URSSAF, CFE, CVAE, AUTRE
  label: text("label").notNull(),
  dueDate: text("due_date").notNull(),
  estimatedCents: real("estimated_cents"),
  paidCents: real("paid_cents"),
  status: text("status").notNull().default("A_VENIR"), // A_VENIR, PAYEE, EN_RETARD
  notes: text("notes"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEcheanceSchema = createInsertSchema(echeancesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEcheance = z.infer<typeof insertEcheanceSchema>;
export type Echeance = typeof echeancesTable.$inferSelect;
