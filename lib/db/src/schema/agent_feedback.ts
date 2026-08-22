import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/** Deux valeurs, pas une échelle : un pouce se donne en un clic. */
export const NOTES_FEEDBACK = ["POUCE_HAUT", "POUCE_BAS"] as const;
export type NoteFeedback = (typeof NOTES_FEEDBACK)[number];

/**
 * Retour à chaud sur une production de l'agent (ticket 4.36, lot C).
 *
 * L'absence de ligne signifie « personne n'a jugé », jamais « c'était bien » :
 * compter les silences comme des pouces en l'air ferait mentir la restitution.
 */
export const agentFeedbackTable = pgTable(
  "agent_feedback",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    typeProduction: text("type_production").notNull(),
    referenceId: text("reference_id"),
    note: text("note").$type<NoteFeedback>().notNull(),
    /** Peut nommer un client : même régime que les transcriptions d'appel. */
    verbatim: text("verbatim"),
    auteurUserId: uuid("auteur_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_feedback_tenant_idx").on(t.tenantId, t.typeProduction, t.createdAt)],
);

export type AgentFeedback = typeof agentFeedbackTable.$inferSelect;
