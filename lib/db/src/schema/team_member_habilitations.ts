import { pgTable, text, date, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { teamMembersTable } from "./team_members";

export const teamMemberHabilitationsTable = pgTable(
  "team_member_habilitations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    membreId: text("membre_id").notNull().references(() => teamMembersTable.id),
    /** Clé stable de suggestion (ex. "habilitation_electrique") — jamais un catalogue fermé. */
    type: text("type").notNull(),
    /** Texte affiché, toujours libre. */
    libelle: text("libelle").notNull(),
    /** NULL = sans expiration (ex. diplôme d'État). */
    dateExpiration: date("date_expiration"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("team_member_habilitations_tenant_idx").on(t.tenantId),
    index("team_member_habilitations_membre_expiration_idx").on(t.membreId, t.dateExpiration),
  ],
);

export const insertTeamMemberHabilitationSchema = createInsertSchema(teamMemberHabilitationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTeamMemberHabilitation = z.infer<typeof insertTeamMemberHabilitationSchema>;
export type TeamMemberHabilitation = typeof teamMemberHabilitationsTable.$inferSelect;
