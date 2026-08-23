import { pgTable, text, date, integer, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Historique des taux horaires de FACTURATION — US-A2.4.
 *
 * ── Pourquoi une histoire et non une colonne ──────────────────────────────
 * Le troisième critère de la story : « un taux modifié en cours d'année, une
 * nouvelle facture applique le taux EN VIGUEUR À LA DATE DE LA PRESTATION ».
 * Une colonne unique écrase, et facturer en mars un travail de janvier
 * appliquerait le taux de mars — indéfendable devant un client.
 *
 * ── À ne pas confondre avec `company.taux_horaire_reel` ───────────────────
 * Celui-là est un COÛT, il sert à calculer une marge. Celui-ci est un PRIX DE
 * VENTE. Les mélanger ferait facturer au prix de revient.
 */
export const tauxHorairesTable = pgTable(
  "taux_horaires",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    /** Le jour où ce taux prend effet. Une DATE métier, jamais un instant. */
    dateEffet: date("date_effet").notNull(),
    montantCents: integer("montant_cents").notNull(),
    /**
     * Un taux peut viser un membre précis — un associé et un junior ne se
     * facturent pas au même prix. `null` = le taux de l'entreprise.
     */
    membreId: text("membre_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("taux_horaires_lecture_idx").on(t.tenantId, t.dateEffet)],
);

export type TauxHoraire = typeof tauxHorairesTable.$inferSelect;
