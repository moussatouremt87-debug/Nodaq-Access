import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nom: text("nom"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
