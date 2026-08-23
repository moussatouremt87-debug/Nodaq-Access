import { boolean, date, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { teamMembersTable } from "./team_members";
import { affairesTable } from "./affaires";
import { clientsTable } from "./clients";

/**
 * Hours worked, per member, per affaire OR client, per day.
 *
 * `heures` is NUMERIC, not real: these hours become money once multiplied by a
 * charged cost, and binary floats do not add up exactly. Drizzle surfaces
 * numeric as a string — always parse it explicitly rather than relying on
 * coercion.
 *
 * `affaireId`/`clientId` : rattachement EXCLUSIF (US-A4.1 — un métier sans
 * "chantier" doit pouvoir pointer directement sur un client, sans créer une
 * affaire fictive pour contourner l'interface). L'un des deux est toujours
 * renseigné, jamais les deux ni aucun — contrainte CHECK portée par le moteur
 * (migration 032), pas seulement par Zod.
 *
 * L'unicité (un couple membre/jour ne pointe qu'une fois sur une même
 * affaire ou un même client) est portée par DEUX index uniques PARTIELS
 * (migration 032) — un UNIQUE composite classique ne fonctionnerait pas ici
 * puisque NULL n'est jamais égal à NULL en SQL, ce qui rendrait la deuxième
 * colonne toujours "unique" par construction. Non représentable dans le
 * schéma Drizzle ci-dessous ; voir la migration pour la définition réelle.
 */
export const pointagesTable = pgTable(
  "pointages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    membreId: text("membre_id")
      .notNull()
      .references(() => teamMembersTable.id, { onDelete: "cascade" }),
    affaireId: text("affaire_id").references(() => affairesTable.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
    /** ISO YYYY-MM-DD — a business date, always built with toDateString. */
    date: date("date").notNull(),
    /** Hours as a NUMERIC string, e.g. "7.50". Parse, never coerce blindly. */
    heures: numeric("heures", { precision: 5, scale: 2 }).notNull(),
    /** 'confirme' (weekly recap, main path) | 'saisi' (manual) | 'importe' */
    /**
   * Ce temps part-il en facture ? (US-B5.4). Défaut vrai : le temps pointé est
   * facturable jusqu'à preuve du contraire. Les trajets, la reprise d'un
   * défaut, la formation interne se marquent faux — et sortent alors du taux
   * d'occupation comme de la facturation au temps.
   */
  facturable: boolean("facturable").notNull().default(true),
  source: text("source").notNull().default("confirme"),
    commentaire: text("commentaire"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("pointages_tenant_date_idx").on(t.tenantId, t.date),
    index("pointages_tenant_affaire_idx").on(t.tenantId, t.affaireId),
    index("pointages_tenant_client_idx").on(t.tenantId, t.clientId),
    index("pointages_tenant_membre_idx").on(t.tenantId, t.membreId, t.date),
  ],
);

export type Pointage = typeof pointagesTable.$inferSelect;

/** Allowed values of `source`, mirrored by the CHECK constraint in 007. */
export const POINTAGE_SOURCES = ["confirme", "saisi", "importe"] as const;
export type PointageSource = (typeof POINTAGE_SOURCES)[number];
