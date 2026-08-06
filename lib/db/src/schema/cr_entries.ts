import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const crEntriesTable = pgTable("cr_entries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** Period key: "YYYY-MM-DD:YYYY-MM-DD" e.g. "2024-01-01:2024-12-31" */
  periodKey: text("period_key").notNull(),
  /** PCG line identifier e.g. "PRODUCTION_VENDUE_SERVICES" */
  lineCode: text("line_code").notNull(),
  /** Amount in cents (integer) */
  amountCents: integer("amount_cents").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CrEntry = typeof crEntriesTable.$inferSelect;
