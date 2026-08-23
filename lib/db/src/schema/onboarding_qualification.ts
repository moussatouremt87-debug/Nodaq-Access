import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import type {
  StadeEntreprise, Effectif, GestionActuelle, Irritant,
} from "@nodaq/shared";

/**
 * Les réponses de qualification à l'inscription (ticket 4.36, lot A).
 *
 * Une ligne par tenant : le parcours se fait une fois, et le refaire écrase.
 * Ce sont des réponses actuelles, pas un journal.
 */
export const onboardingQualificationTable = pgTable("onboarding_qualification", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenantsTable.id),
  stade: text("stade").$type<StadeEntreprise>(),
  effectif: text("effectif").$type<Effectif>(),
  gestionActuelle: text("gestion_actuelle").$type<GestionActuelle>(),
  logicielActuel: text("logiciel_actuel"),
  irritant: text("irritant").$type<Irritant>(),
  /** Peut nommer un client : même régime que les verbatims de feedback. */
  irritantVerbatim: text("irritant_verbatim"),
  /**
   * Le métier tel que l'utilisateur l'écrit, quand aucun secteur de la liste
   * ne convient (US-A1.4). Sert à choisir le prochain module sectoriel — pas
   * à configurer le compte, qui reste sur le pack neutre « autre ».
   */
  secteurLibre: text("secteur_libre"),
  termineeLe: timestamp("terminee_le", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OnboardingQualification = typeof onboardingQualificationTable.$inferSelect;
