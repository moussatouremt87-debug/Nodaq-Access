import { pgTable, text, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pendingActionsTable = pgTable("pending_actions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text("type").notNull(),
  status: text("status").notNull().default("EN_ATTENTE"),
  label: text("label").notNull(),
  description: text("description"),
  affaireId: text("affaire_id"),
  affaireLabel: text("affaire_label"),
  amountCents: real("amount_cents"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const insertPendingActionSchema = createInsertSchema(pendingActionsTable).omit({ id: true, createdAt: true });
export type InsertPendingAction = z.infer<typeof insertPendingActionSchema>;
export type PendingAction = typeof pendingActionsTable.$inferSelect;
