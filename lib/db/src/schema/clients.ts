import { pgTable, text, timestamp, boolean, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const TYPES_CLIENT = ["PARTICULIER", "PRO"] as const;
export type TypeClient = (typeof TYPES_CLIENT)[number];

/**
 * Fiche client — l'entité qui manquait.
 *
 * Le nom du client était du texte libre recopié séparément sur l'affaire, le
 * devis, la facture et le prospect : « M. Dupont » ne désignait aucune entité,
 * et rien ne pouvait se propager d'un objet à l'autre.
 *
 * PAS D'UNICITÉ SUR LE NOM : deux Dupont existent, et c'est le cas ordinaire
 * dans une commune. Une contrainte forcerait l'artisan à inventer des suffixes.
 */
export const clientsTable = pgTable(
  "clients",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    nom: text("nom").notNull(),
    type: text("type").notNull().default("PARTICULIER"),
    email: text("email"),
    telephone: text("telephone"),
    adresse: text("adresse"),
    codePostal: text("code_postal"),
    ville: text("ville"),
    siret: text("siret"),
    notes: text("notes"),
    archive: boolean("archive").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("clients_tenant_archive_idx").on(t.tenantId, t.archive)],
);

export const insertClientSchema = createInsertSchema(clientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
