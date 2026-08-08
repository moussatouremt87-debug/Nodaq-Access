import { pgTable, text, timestamp, uuid, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const teamMembersTable = pgTable("team_members", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  role: text("role").notNull().default("Collaborateur"),
  email: text("email"),
  availability: text("availability").notNull().default("DISPONIBLE"),
  /** JSON array of { day: 'LUN'|'MAR'|..., affaireId: string|null } */
  schedule: text("schedule").notNull().default("[]"),
  /** Type de lien contractuel : SALARIE | SOUS_TRAITANT | APPRENTI */
  typeLien: text("type_lien").notNull().default("SALARIE"),
  /** Nombre de jours travaillés par semaine (5 par défaut) */
  joursParSemaine: real("jours_par_semaine").notNull().default(5),
  /** Coût mensuel chargé en euros (null = non renseigné) */
  coutMensuelCharge: real("cout_mensuel_charge"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;
