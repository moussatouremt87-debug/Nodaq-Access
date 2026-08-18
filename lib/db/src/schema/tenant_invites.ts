import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Invitation d'un collaborateur à rejoindre un tenant existant — voir
 * migration 027, étendue par 038 (US-A5.1). `role` peut valoir `OWNER`
 * depuis 038 — un OWNER existant peut désigner un co-OWNER par invitation,
 * à égalité (contrainte CHECK en base, pas seulement Zod). La PROMOTION
 * d'un membre déjà présent en OWNER reste refusée ailleurs
 * (`PATCH /membres/:id/role`) : seule cette voie crée un co-OWNER.
 * `tokenSha256` est un condensat : le jeton en clair ne vit que dans le
 * lien envoyé par e-mail (même doctrine que `devis.accept_token_sha256`,
 * migration 014). `acceptedAt` non nul signale une invitation déjà
 * consommée — jamais supprimée, seulement acceptée ou laissée expirer
 * (`app_user` n'a pas DELETE, voir create-app-role.cjs).
 */
export const tenantInvitesTable = pgTable("tenant_invites", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  email: text("email").notNull(),
  /** 'MEMBER' | 'ACCOUNTANT' | 'OWNER' | 'VIEWER' — contrainte CHECK en base
   *  (élargie par 039 pour le tiers de confiance, US-A5.4). */
  role: text("role").notNull(),
  /** Qualificatif libre, reporté sur le membership à l'acceptation
   *  (US-A5.1) — voir memberships.libelle. */
  libelle: text("libelle"),
  /** Échéance de l'ACCÈS accordé, reportée sur `memberships.expires_at` à
   *  l'acceptation (US-A5.4). À ne pas confondre avec `expiresAt` ci-dessous,
   *  qui est la validité du LIEN d'invitation : deux horloges distinctes —
   *  le délai pour accepter, et la durée de l'accès une fois accepté.
   *  Obligatoire pour un `VIEWER`, refusée sinon (routes/membres.ts). */
  accesExpireAt: timestamp("acces_expire_at", { withTimezone: true }),
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
