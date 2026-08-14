import { pgTable, text, timestamp, real, uuid, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { bytea } from "./archived_pdfs";

export const classeurTable = pgTable("classeur_documents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  category: text("category").notNull().default("DIVERS"),
  size: real("size"), // bytes
  mimeType: text("mime_type"),
  notes: text("notes"),
  affaireId: text("affaire_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClasseurSchema = createInsertSchema(classeurTable).omit({ id: true, createdAt: true });
export type InsertClasseurDocument = z.infer<typeof insertClasseurSchema>;
export type ClasseurDocument = typeof classeurTable.$inferSelect;

/**
 * Octets d'un document du Classeur — table séparée de `classeur_documents`,
 * voir 029_classeur_document_bytes.sql pour le raisonnement complet.
 */
export const classeurDocumentBytesTable = pgTable("classeur_document_bytes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  documentId: text("document_id").notNull().references(() => classeurTable.id),
  bytes: bytea("bytes").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClasseurDocumentBytes = typeof classeurDocumentBytesTable.$inferSelect;
export type InsertClasseurDocumentBytes = typeof classeurDocumentBytesTable.$inferInsert;
