import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const pendingActionsTable = pgTable("pending_actions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("EN_ATTENTE"),
  label: text("label").notNull(),
  description: text("description"),
  affaireId: text("affaire_id"),
  affaireLabel: text("affaire_label"),
  amountCents: integer("amount_cents"),
  /**
   * Charge utile structurée — le PLAN. Le libellé lisible reste dans `label` :
   * un humain doit pouvoir comprendre ce qu'il valide sans lire du JSON.
   */
  payload: jsonb("payload").$type<unknown>(),
  /**
   * Un plan non validé expire. Sans cela, une phrase dictée le mardi pourrait
   * être appliquée le vendredi, contre des données qui ont changé entre-temps.
   */
  expireLe: timestamp("expire_le", { withTimezone: true }),
  /**
   * Horodatage de l'exécution. C'est lui qui rend le rejeu inoffensif : un
   * plan déjà appliqué en porte un, et la route refuse de le rejouer.
   */
  executeLe: timestamp("execute_le", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const insertPendingActionSchema = createInsertSchema(pendingActionsTable).omit({ id: true, createdAt: true });
export type InsertPendingAction = z.infer<typeof insertPendingActionSchema>;
export type PendingAction = typeof pendingActionsTable.$inferSelect;
