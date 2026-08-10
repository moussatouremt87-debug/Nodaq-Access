import { pgTable, text, timestamp, real, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const prospectsTable = pgTable("prospects", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  companyName: text("company_name"),
  phone: text("phone"),
  email: text("email"),
  stage: text("stage").notNull().default("NOUVEAU"),
  source: text("source").notNull().default("AUTRE"),
  estimatedValueCents: real("estimated_value_cents"),
  notes: text("notes"),
  /**
   * Lien vers la fiche client. NULLABLE, et le nom en clair de cette table
   * reste la valeur AFFICHÉE sur un document émis : le texte est un
   * instantané, `clientId` est le lien. Renommer une fiche ne doit pas
   * réécrire un document déjà imprimé.
   */
  clientId: text("client_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProspectSchema = createInsertSchema(prospectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProspect = z.infer<typeof insertProspectSchema>;
export type Prospect = typeof prospectsTable.$inferSelect;
