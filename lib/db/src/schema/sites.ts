import { pgTable, text, uuid, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Un site couvert par un contrat multi-sites — US-B7.1.
 *
 * Une entreprise de nettoyage signe UN contrat avec un client qui a huit
 * agences. Chaque site se planifie et se suit séparément ; la facturation,
 * elle, reste consolidée — une ligne par site sur une seule facture, parce que
 * c'est le client qu'on facture, pas le bâtiment.
 *
 * `montantCents` est NULLABLE : un site peut exister pour être planifié sans
 * être facturé séparément (une tournée incluse dans un forfait global). Le
 * montant du contrat sert alors de repli.
 */
export const sitesTable = pgTable("sites", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  clientId: text("client_id").notNull(),
  contratId: text("contrat_id"),
  libelle: text("libelle").notNull(),
  adresse: text("adresse"),
  codePostal: text("code_postal"),
  ville: text("ville"),
  montantCents: integer("montant_cents"),
  actif: boolean("actif").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  contratLibelle: uniqueIndex("sites_contrat_libelle_idx").on(t.tenantId, t.contratId, t.libelle),
}));
