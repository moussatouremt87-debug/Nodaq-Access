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
  // MFA (ticket 4.15) — NULL = CETTE session n'a pas encore prouvé le second
  // facteur. Le MFA se vérifie une fois par connexion, pas une fois pour
  // toutes : un cookie volé sur un appareil qui n'a jamais passé le MFA ne
  // doit pas hériter d'un MFA validé ailleurs. Voir migration 028.
  mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
});

export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = typeof sessionsTable.$inferInsert;
