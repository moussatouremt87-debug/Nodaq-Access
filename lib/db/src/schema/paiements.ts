import { pgTable, text, timestamp, integer, uuid, date, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const SENS_PAIEMENT = ["ENCAISSEMENT", "REMBOURSEMENT"] as const;
export type SensPaiement = (typeof SENS_PAIEMENT)[number];

export const MOYENS_PAIEMENT = ["VIREMENT", "CHEQUE", "ESPECES", "CB", "AUTRE"] as const;
export type MoyenPaiement = (typeof MOYENS_PAIEMENT)[number];

export const NATURES_PAIEMENT = ["ACOMPTE", "SITUATION", "SOLDE", "AUTRE"] as const;
export type NaturePaiement = (typeof NATURES_PAIEMENT)[number];

/**
 * Journal des paiements — APPEND-ONLY, imposé par le moteur.
 *
 * Une facture portait un booléen « soldée » et rien d'autre : ni date de
 * règlement, ni montant, ni acompte, ni paiement partiel.
 *
 * Une erreur se corrige par une écriture INVERSE (`sens = 'REMBOURSEMENT'`),
 * jamais par un UPDATE : `app_user` n'a que SELECT et INSERT, et c'est le
 * moteur qui le tient, pas le code.
 *
 * Les trois rattachements sont indépendants et nullables : un acompte encaissé
 * AVANT toute facture porte `factureId` nul et `affaireId` renseigné.
 */
export const paiementsTable = pgTable(
  "paiements",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    clientId: text("client_id"),
    factureId: text("facture_id"),
    affaireId: text("affaire_id"),
    /** Date MÉTIER du règlement (`YYYY-MM-DD`), pas l'instant de la saisie. */
    date: date("date").notNull(),
    /** Toujours strictement positif : le signe est porté par `sens`. */
    montantCents: integer("montant_cents").notNull(),
    sens: text("sens").notNull().default("ENCAISSEMENT"),
    moyen: text("moyen").notNull().default("AUTRE"),
    nature: text("nature").notNull().default("AUTRE"),
    reference: text("reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("paiements_tenant_facture_idx").on(t.tenantId, t.factureId),
    index("paiements_tenant_affaire_idx").on(t.tenantId, t.affaireId),
  ],
);

export type Paiement = typeof paiementsTable.$inferSelect;
