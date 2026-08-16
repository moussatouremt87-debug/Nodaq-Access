import { pgTable, text, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { bankConnectionsTable } from "./bank_connections";

/**
 * bank_accounts — un compte bancaire connecté, avec son solde COURANT
 * (instantané, pas un historique). Mis à jour par le webhook Bridge
 * (item.account.created / item.account.updated).
 */
export const bankAccountsTable = pgTable("bank_accounts", {
  /** Identifiant Bridge du compte — pas de $defaultFn, fourni explicitement. */
  id: text("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  connectionId: text("connection_id")
    .notNull()
    .references(() => bankConnectionsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  balanceCents: integer("balance_cents").notNull(),
  devise: text("devise").notNull().default("EUR"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BankAccount = typeof bankAccountsTable.$inferSelect;
export type InsertBankAccount = typeof bankAccountsTable.$inferInsert;
