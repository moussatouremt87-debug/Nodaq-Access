import { pgTable, text, timestamp, integer, real, json, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const devisTable = pgTable("devis", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  reference: text("reference").notNull(),
  clientName: text("client_name").notNull(),
  status: text("status").notNull().default("BROUILLON"),
  lines: json("lines").$type<DevisLine[]>().notNull().default([]),
  /** Total HT in integer cents */
  totalHTCents: integer("total_ht_cents").notNull().default(0),
  /** Total TTC in integer cents */
  totalTTCCents: integer("total_ttc_cents").notNull().default(0),
  tvaRate: real("tva_rate").notNull().default(20),
  remise: real("remise").notNull().default(0),
  notes: text("notes"),
  validUntil: text("valid_until"),
  affaireId: text("affaire_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DevisLine = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
};

export const insertDevisSchema = createInsertSchema(devisTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDevis = z.infer<typeof insertDevisSchema>;
export type Devis = typeof devisTable.$inferSelect;
