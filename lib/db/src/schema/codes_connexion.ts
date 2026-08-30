import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Code à usage unique envoyé par courriel pour prouver le second facteur.
 *
 * Sans `tenant_id`, comme `sessions` : la table est attachée à l'UTILISATEUR,
 * qui peut appartenir à plusieurs espaces. Hors `BUSINESS_TABLES`, hors RLS.
 */
export const codesConnexionTable = pgTable("codes_connexion", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** Condensat seul : le code en clair ne vit que dans le courriel. */
  codeSha256: text("code_sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Usage unique : un code accepté ne resservira pas. */
  usedAt: timestamp("used_at", { withTimezone: true }),
  /** Plafond d'essais — c'est lui qui rend six chiffres suffisants. */
  tentatives: integer("tentatives").notNull().default(0),
});

export type CodeConnexion = typeof codesConnexionTable.$inferSelect;
