import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * pa_transmissions — suivi d'une transmission sortante (facture ou agrégat
 * e-reporting) vers une plateforme agréée (US-A2.6).
 *
 * Une ligne par document, mise à jour au fil des statuts — voir
 * lib/plateforme-agreee (réexporte isValidTransition/SUBMISSION_STATUSES de
 * @nodaq/facturx) pour la validation des transitions. Table mutable,
 * contrairement à pa_documents_recus.
 */
export const paTransmissionsTable = pgTable("pa_transmissions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  /** "FACTURE" ou "E_REPORTING". */
  documentType: text("document_type").notNull(),
  /** Id de facture NODAQ, ou clé de période pour un agrégat e-reporting. */
  documentId: text("document_id").notNull(),
  /** Identifiant attribué par la PA — absent tant que le premier dépôt n'a pas réussi. */
  submissionId: text("submission_id"),
  /** Une des SUBMISSION_STATUSES de @nodaq/facturx. */
  statut: text("statut").notNull(),
  erreur: text("erreur"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaTransmission = typeof paTransmissionsTable.$inferSelect;
export type InsertPaTransmission = typeof paTransmissionsTable.$inferInsert;
