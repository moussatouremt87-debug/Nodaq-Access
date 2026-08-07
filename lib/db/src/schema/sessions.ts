import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/** DB-backed sessions — created at login, deleted at logout or expiry. */
export const sessionsTable = pgTable("sessions", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = typeof sessionsTable.$inferInsert;
