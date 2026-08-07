import { pgTable, text, timestamp, integer, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

/**
 * Avoir (credit note) — document distinct d'une facture, toujours lié à une
 * facture EMISE. Un avoir ne se modifie pas, ne se supprime pas.
 * Séquence propre : AVOIR-YYYY-NNNN.
 */
export const avoirsTable = pgTable("avoirs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  /** Sequential number: AVOIR-YYYY-NNNN */
  numero: text("numero").notNull(),
  /** ID of the EMISE facture this avoir corrects */
  factureRefId: text("facture_ref_id").notNull(),
  /** Amount of the credit note in HT cents (≤ facture total HT) */
  montantHtCents: integer("montant_ht_cents").notNull(),
  /** VAT amount in cents */
  montantTvaCents: integer("montant_tva_cents").notNull().default(0),
  /** Free-text reason for the avoir */
  motif: text("motif").notNull(),
  /** SHA-256 hex of the avoir PDF */
  pdfSha256: text("pdf_sha256"),
  pdfPath: text("pdf_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAvoirSchema = createInsertSchema(avoirsTable).omit({ id: true, createdAt: true });
export type InsertAvoir = z.infer<typeof insertAvoirSchema>;
export type Avoir = typeof avoirsTable.$inferSelect;
