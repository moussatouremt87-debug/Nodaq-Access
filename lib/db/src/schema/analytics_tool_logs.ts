import { pgTable, text, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Logs each call to the get_indicateur chat tool.
 * Spec §16 : identifiant, période, durée, statut uniquement.
 * JAMAIS la question, JAMAIS la réponse, JAMAIS une valeur.
 */
export const analyticsToolLogsTable = pgTable("analytics_tool_logs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  indicateurId: text("indicateur_id").notNull(),
  periodeDebut: text("periode_debut"),
  periodeFin: text("periode_fin"),
  comparaisonMode: text("comparaison_mode"),
  durationMs: integer("duration_ms").notNull().default(0),
  /** 'ok' | 'insuffisantes' | 'erreur' */
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
