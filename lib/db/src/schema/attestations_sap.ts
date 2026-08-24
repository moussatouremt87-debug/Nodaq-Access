import { pgTable, text, uuid, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Attestation fiscale annuelle des services à la personne — US-B4.1.
 *
 * Les montants sont FIGÉS à la génération, délibérément : une attestation
 * régénérée doit afficher exactement le chiffre déjà transmis au client et à
 * l'administration. Un encaissement corrigé après coup ne réécrit pas un
 * document parti.
 */
export const attestationsSapTable = pgTable("attestations_sap", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  clientId: text("client_id").notNull(),
  annee: integer("annee").notNull(),
  montantEligibleCents: integer("montant_eligible_cents").notNull(),
  aidesCents: integer("aides_cents").notNull().default(0),
  genereLe: timestamp("genere_le", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  clientAnnee: uniqueIndex("attestations_sap_client_annee_idx").on(t.tenantId, t.clientId, t.annee),
}));
