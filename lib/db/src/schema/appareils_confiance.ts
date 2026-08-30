import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Appareil déjà prouvé — on n'y redemande plus de code pendant 90 jours.
 *
 * C'est ce qui fait passer le second facteur de « chaque connexion » à « trois
 * ou quatre fois par an ». Le jeton ne vit ici qu'en condensat.
 */
export const appareilsConfianceTable = pgTable("appareils_confiance", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  jetonSha256: text("jeton_sha256").notNull().unique(),
  /** « Chrome sur Mac » — de quoi reconnaître, jamais de quoi pister. */
  libelle: text("libelle"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  derniereVue: timestamp("derniere_vue", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type AppareilConfiance = typeof appareilsConfianceTable.$inferSelect;
