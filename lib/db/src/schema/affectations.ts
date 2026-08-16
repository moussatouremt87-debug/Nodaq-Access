import { pgTable, text, timestamp, boolean, uuid, date, numeric, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { clientsTable } from "./clients";

/**
 * Affectations — LE PRÉVU.
 *
 * ╔═════════════════════════════════════════════════════════════════════════╗
 * ║  UNE HEURE PRÉVUE N'ENTRE JAMAIS DANS LE CALCUL D'UNE MARGE.           ║
 * ║  Le réalisé vit dans `pointages`, et lui seul compte.                   ║
 * ╚═════════════════════════════════════════════════════════════════════════╝
 *
 * Les confondre gonflerait le coût de main-d'œuvre d'un chantier avec des
 * heures que personne n'a travaillées : un chantier prévu sur un mois puis
 * annulé au bout de trois jours ne coûte pas un mois de salaire.
 */
export const affectationsTable = pgTable(
  "affectations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    /**
     * Rattachement EXCLUSIF à une affaire OU à un client (US-A4.1) — un métier
     * sans "chantier" pointe directement sur un client, sans affaire fictive.
     * L'un des deux est toujours renseigné, contrainte CHECK en migration 032.
     */
    affaireId: text("affaire_id"),
    clientId: text("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
    membreId: text("membre_id").notNull(),
    /** Dates MÉTIER, en composantes locales. Jamais un instant. */
    dateDebut: date("date_debut").notNull(),
    dateFin: date("date_fin").notNull(),
    heuresParJour: numeric("heures_par_jour", { precision: 4, scale: 2 }).notNull(),
    joursOuvresSeulement: boolean("jours_ouvres_seulement").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("affectations_tenant_periode_idx").on(t.tenantId, t.dateDebut, t.dateFin),
    index("affectations_tenant_membre_idx").on(t.tenantId, t.membreId),
    index("affectations_tenant_client_idx").on(t.tenantId, t.clientId),
  ],
);

export type Affectation = typeof affectationsTable.$inferSelect;
