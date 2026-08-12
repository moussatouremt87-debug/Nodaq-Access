import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Invitation d'un collaborateur à rejoindre un tenant existant — voir
 * migration 027. `role` ne peut jamais valoir `OWNER` (contrainte CHECK en
 * base, pas seulement Zod). `tokenSha256` est un condensat : le jeton en
 * clair ne vit que dans le lien envoyé par e-mail (même doctrine que
 * `devis.accept_token_sha256`, migration 014). `acceptedAt` non nul signale
 * une invitation déjà consommée — jamais supprimée, seulement acceptée ou
 * laissée expirer (`app_user` n'a pas DELETE, voir create-app-role.cjs).
 */
export const tenantInvitesTable = pgTable("tenant_invites", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  email: text("email").notNull(),
  /** 'MEMBER' | 'ACCOUNTANT' — jamais 'OWNER', contrainte CHECK en base. */
  role: text("role").notNull(),
  tokenSha256: text("token_sha256").notNull(),
  invitedBy: uuid("invited_by").notNull().references(() => usersTable.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTenantInviteSchema = createInsertSchema(tenantInvitesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTenantInvite = z.infer<typeof insertTenantInviteSchema>;
export type TenantInvite = typeof tenantInvitesTable.$inferSelect;
