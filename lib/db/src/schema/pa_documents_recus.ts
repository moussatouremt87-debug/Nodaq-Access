import { pgTable, text, uuid, integer, timestamp, date } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { bytea } from "./archived_pdfs";

/**
 * pa_documents_recus — factures Factur-X reçues d'un fournisseur via une
 * plateforme agréée (US-A2.6), immuables une fois captées.
 *
 * app_user a SELECT + INSERT uniquement (REVOKE au niveau de l'objet,
 * migration 030) — même doctrine que `archived_pdfs`.
 */
export const paDocumentsRecusTable = pgTable("pa_documents_recus", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  /** Octets du Factur-X reçu. */
  bytes: bytea("bytes").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  /** "manuel" (dépôt par le tenant) ou "api" (poussé par une PA contractée). */
  source: text("source").notNull(),
  /** SIREN de l'émetteur, extrait du XML CII quand disponible. */
  fournisseurSiren: text("fournisseur_siren"),
  montantTtcCents: integer("montant_ttc_cents"),
  dateFacture: date("date_facture"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaDocumentRecu = typeof paDocumentsRecusTable.$inferSelect;
export type InsertPaDocumentRecu = typeof paDocumentsRecusTable.$inferInsert;
