import { pgTable, text, timestamp, uuid, boolean, integer, index, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Règle de négociation de la relance (ticket 4.18, US-9) — ce que le dirigeant
 * autorise son agent vocal à accorder pendant un appel.
 *
 * VERSIONNÉE, jamais écrasée : l'US-9 exige qu'« un changement de règle ne
 * modifie jamais rétroactivement une campagne déjà validée ». Chaque
 * modification insère une version ; la règle courante est celle de `version`
 * maximale, et un mandat de campagne fige le numéro qui s'appliquait.
 *
 * APPEND-ONLY AU NIVEAU DU MOTEUR : `app_user` n'a que SELECT et INSERT (voir
 * migration 041 et `create-app-role.cjs`). Une version posée ne se réécrit pas
 * depuis l'application — une règle réécrite après coup, ce serait un mandat
 * qu'on peut nier avoir donné.
 */
export const reglesRelanceTable = pgTable(
  "regles_relance",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    version: integer("version").notNull(),

    /** Défaut FALSE : l'autonomie de négociation est un choix explicite (US-9). */
    echelonnementAutorise: boolean("echelonnement_autorise").notNull().default(false),
    maxVersements: integer("max_versements").notNull().default(3),
    delaiMaxPremierVersementJours: integer("delai_max_premier_versement_jours").notNull().default(15),
    /** Retard maximal acceptable, en jours après l'échéance de la facture. */
    retardMaxJours: integer("retard_max_jours").notNull().default(30),
    lienPaiementAutorise: boolean("lien_paiement_autorise").notNull().default(false),
    /** Défaut FALSE, et il faut un geste délibéré pour l'ouvrir (US-9). */
    remiseAutorisee: boolean("remise_autorisee").notNull().default(false),

    /**
     * Instantané de l'auteur, sans clé étrangère — même doctrine que
     * `journal_decisions` : un compte supprimé ne doit pas effacer la trace de
     * qui a autorisé quoi.
     */
    poseePar: uuid("posee_par"),
    poseeParEmail: text("posee_par_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("regles_relance_courante_idx").on(t.tenantId, t.version),
    unique().on(t.tenantId, t.version),
  ],
);

export type RegleRelance = typeof reglesRelanceTable.$inferSelect;
