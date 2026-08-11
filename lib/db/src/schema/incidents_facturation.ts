import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { facturesTable } from "./factures";

/**
 * Trace durable d'une incohérence de facturation que le moteur n'a pas pu
 * réparer lui-même — aujourd'hui, une compensation d'avoir qui a échoué à son
 * tour (voir routes/avoirs.ts et lib/incidents-facturation.ts). Append-only :
 * `resolu_le` existe pour un futur écran de résolution, mais rien n'écrit
 * encore dessus dans ce lot, et `app_user` n'a que SELECT/INSERT (migration
 * 026).
 */
export const incidentsFacturationTable = pgTable("incidents_facturation", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  /** Un seul type existe aujourd'hui : 'AVOIR_COMPENSATION_ECHOUEE'. */
  type: text("type").notNull(),
  factureId: text("facture_id").notNull().references(() => facturesTable.id),
  /**
   * De quoi réparer sans enquête — voir lib/incidents-facturation.ts pour la
   * forme exacte. Peut contenir des données métier (motif de l'avoir) : cette
   * colonne n'est pas un journal, elle est protégée par RLS comme toute table
   * métier.
   */
  chargeUtile: jsonb("charge_utile").$type<unknown>().notNull(),
  constateLe: timestamp("constate_le", { withTimezone: true }).notNull().defaultNow(),
  resoluLe: timestamp("resolu_le", { withTimezone: true }),
});

export const insertIncidentFacturationSchema = createInsertSchema(incidentsFacturationTable).omit({ id: true, constateLe: true });
export type InsertIncidentFacturation = z.infer<typeof insertIncidentFacturationSchema>;
export type IncidentFacturation = typeof incidentsFacturationTable.$inferSelect;
