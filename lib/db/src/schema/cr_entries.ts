import { pgTable, text, integer, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const crEntriesTable = pgTable(
  "cr_entries",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    /** Period key: "YYYY-MM-DD:YYYY-MM-DD" e.g. "2024-01-01:2024-12-31" */
    periodKey: text("period_key").notNull(),
    /** PCG line identifier e.g. "PRODUCTION_VENDUE_SERVICES" */
    lineCode: text("line_code").notNull(),
    /** Amount in cents (integer) */
    amountCents: integer("amount_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Tenant-scoped uniqueness: one entry per period+line per tenant
    unique("cr_entries_tenant_period_line").on(t.tenantId, t.periodKey, t.lineCode),
  ],
);

export type CrEntry = typeof crEntriesTable.$inferSelect;
