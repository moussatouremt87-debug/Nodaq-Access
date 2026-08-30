import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const activityTable = pgTable("activity", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  type: text("type").notNull(),
  label: text("label").notNull(),
  meta: text("meta"),
  /**
   * QUI a déclenché cette activité. `null` = le SYSTÈME.
   *
   * Une activité sans auteur n'est pas une donnée manquante : c'est un
   * renouvellement d'abonnement, un objectif franchi, une relance exécutée.
   * Rendre la colonne obligatoire aurait forcé à inventer un auteur, et
   * l'écran aurait affiché un nom là où personne n'a rien fait.
   */
  auteurUserId: uuid("auteur_user_id"),
  /**
   * Le nom AU MOMENT DES FAITS, copié à côté de l'identifiant.
   *
   * Un membre qui quitte l'entreprise ne doit pas effacer l'historique de ce
   * qu'il a fait : une jointure rendrait « (inconnu) » sur des mois
   * d'activité.
   */
  auteurNom: text("auteur_nom"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activityTable).omit({ id: true, createdAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activityTable.$inferSelect;
