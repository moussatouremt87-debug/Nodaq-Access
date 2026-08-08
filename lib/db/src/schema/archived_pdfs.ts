import { customType, pgTable, text, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Custom bytea type: Buffer in application code, BYTEA in PostgreSQL.
 * node-postgres automatically parses BYTEA columns to Buffer objects.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer): Buffer {
    return value;
  },
  fromDriver(value: Buffer): Buffer {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  },
});

/**
 * archived_pdfs — immutable PDF archive.
 *
 * Stores the exact bytes emitted by the invoicing engine.
 * app_user has SELECT + INSERT only (enforced via REVOKE at the object level),
 * making every archived PDF tamper-proof at the database level.
 *
 * Separate from `factures` and `avoirs` deliberately: SELECT * on those tables
 * must never pull megabytes of BYTEA into list-route responses.
 */
export const archivedPdfsTable = pgTable("archived_pdfs", {
  id: text("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  /** "FACTURE" or "AVOIR" */
  documentType: text("document_type").notNull(),
  /** UUID of the facture or avoir this PDF belongs to */
  documentId: text("document_id").notNull(),
  /** Full PDF bytes */
  bytes: bytea("bytes").notNull(),
  /** SHA-256 hex of `bytes` — must equal the SHA stored on the parent document */
  sha256: text("sha256").notNull(),
  /** byte_size == bytes.length, stored for monitoring without loading the blob */
  byteSize: integer("byte_size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ArchivedPdf = typeof archivedPdfsTable.$inferSelect;
export type InsertArchivedPdf = typeof archivedPdfsTable.$inferInsert;
