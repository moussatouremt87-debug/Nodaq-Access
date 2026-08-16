import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * bank_connections — connexion bancaire Bridge d'un tenant (connecteur
 * bancaire, préalable à US-A3.5). Une ligne par tenant.
 *
 * `bridgeUserUuid`/`bridgeItemId` ne sont PAS des secrets — inutilisables
 * sans le Client-Secret plateforme (protégé en variable d'environnement,
 * jamais en base) — voir @nodaq/banque-agreee.
 */
export const bankConnectionsTable = pgTable("bank_connections", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  bridgeUserUuid: text("bridge_user_uuid").notNull(),
  bridgeItemId: text("bridge_item_id"),
  /** "en_attente" | "connecte" | "erreur" | "deconnecte". */
  statut: text("statut").notNull().default("en_attente"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const BANK_CONNECTION_STATUSES = ["en_attente", "connecte", "erreur", "deconnecte"] as const;
export type BankConnectionStatus = (typeof BANK_CONNECTION_STATUSES)[number];

export type BankConnection = typeof bankConnectionsTable.$inferSelect;
export type InsertBankConnection = typeof bankConnectionsTable.$inferInsert;
