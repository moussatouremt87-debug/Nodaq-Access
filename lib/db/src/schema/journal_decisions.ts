import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Journal des décisions humaines sur les actions proposées par l'assistant
 * (US-A6.4) — la preuve à produire en cas de contrôle ou de litige.
 *
 * DISTINCT de `pending_actions`, et volontairement : celle-ci est une file de
 * travail, mutable par nature (le statut change, la ligne peut être purgée).
 * Un journal de contrôle bâti dessus serait modifiable a posteriori, ce que la
 * story interdit explicitement.
 *
 * APPEND-ONLY AU NIVEAU DU MOTEUR : `app_user` n'a que SELECT et INSERT (voir
 * migration 040 et `create-app-role.cjs`). Aucune écriture de correction n'est
 * possible depuis l'application — pas même par erreur.
 */
export const journalDecisionsTable = pgTable(
  "journal_decisions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    /** Pas de FK vers pending_actions : la ligne d'origine peut être purgée,
     *  le journal doit lui survivre. */
    actionId: text("action_id").notNull(),
    actionType: text("action_type").notNull(),
    /** Instantané du libellé proposé, tel qu'il a été soumis à l'humain. */
    actionLabel: text("action_label").notNull(),
    /** Instantané du contenu exact proposé (AC1). */
    actionPayload: jsonb("action_payload").$type<unknown>(),
    /** APPROUVEE | REJETEE | EXPIREE — contrainte CHECK en base. */
    decision: text("decision").notNull(),
    decideeLe: timestamp("decidee_le", { withTimezone: true }).notNull().defaultNow(),
    /** NULL = expiration : personne n'a décidé, et c'est l'information.
     *  Sans FK vers `users` : une clé étrangère forcerait, à la suppression
     *  d'un compte, soit à bloquer cette suppression, soit à MODIFIER le
     *  journal (ON DELETE SET NULL) qu'on déclare immuable. Le rattachement
     *  lisible est `decideeParEmail`. */
    decideePar: uuid("decidee_par"),
    /** Instantané : un compte supprimé n'efface pas la trace de qui a décidé. */
    decideeParEmail: text("decidee_par_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("journal_decisions_tenant_date_idx").on(t.tenantId, t.decideeLe),
    index("journal_decisions_action_idx").on(t.actionId),
  ],
);

export type JournalDecision = typeof journalDecisionsTable.$inferSelect;
export type InsertJournalDecision = typeof journalDecisionsTable.$inferInsert;
