import { pgTable, text, timestamp, uuid, primaryKey } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Key-value settings store, scoped per tenant.
 * Primary key is (tenant_id, key) — a single key can exist once per tenant.
 */
export const settingsTable = pgTable(
  "settings",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.key] }),
  ],
);

export type Setting = typeof settingsTable.$inferSelect;
