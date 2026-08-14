import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Une entrée de récupération MFA — consommée une fois, jamais retirée. */
export interface CodeRecuperationMfa {
  readonly hash: string;
  readonly usedAt: string | null;
}

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nom: text("nom"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // MFA (ticket 4.15) — voir migration 028 pour le raisonnement complet.
  // NULL = jamais enrôlé. Chiffré via @nodaq/crypto, jamais en clair.
  mfaSecretChiffre: text("mfa_secret_chiffre"),
  // NULL = non enrôlé ; posé seulement après le premier code TOTP correct.
  mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
  mfaRecoveryCodes: jsonb("mfa_recovery_codes").$type<CodeRecuperationMfa[]>(),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
