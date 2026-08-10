import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  uuid,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Catalogue tarifaire du tenant — la SEULE source de prix du devis dicté.
 *
 * Le modèle découpe une dictée en intentions ; le prix vient de cette table ou
 * n'existe pas. Une intention sans correspondance produit une ligne « à
 * compléter », jamais un prix inventé (CLAUDE.md §3).
 */
export const catalogueLignesTable = pgTable(
  "catalogue_lignes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    libelle: text("libelle").notNull(),
    unite: text("unite"),
    /** Prix en centimes — de l'argent, jamais un flottant. */
    prixUnitaireHtCents: integer("prix_unitaire_ht_cents").notNull(),
    tauxTva: real("taux_tva").notNull().default(20),
    /** Termes sous lesquels l'artisan désigne l'ouvrage à l'oral. */
    motsCles: text("mots_cles").array().notNull().default([]),
    /** 'saisi' (à la main) | 'reprise' (déduit des devis déjà émis). */
    origine: text("origine").notNull().default("saisi"),
    actif: boolean("actif").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("catalogue_lignes_unique_libelle").on(t.tenantId, t.libelle),
    index("catalogue_lignes_tenant_actif_idx").on(t.tenantId, t.actif),
  ],
);

export type CatalogueLigne = typeof catalogueLignesTable.$inferSelect;

export const CATALOGUE_ORIGINES = ["saisi", "reprise"] as const;
export type CatalogueOrigine = (typeof CATALOGUE_ORIGINES)[number];
