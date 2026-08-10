import { pgTable, text, timestamp, uuid, index, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Alias appris du catalogue — une CORRECTION HUMAINE, jamais une déduction.
 *
 * L'artisan a dicté « du placo », le produit n'a rien trouvé, il a désigné
 * lui-même « Cloison BA13 ». On retient l'association pour ne plus lui reposer
 * la question.
 *
 * Rien n'est appris d'un rapprochement automatique : apprendre de ses propres
 * suppositions ferait dériver le catalogue sans que personne s'en aperçoive.
 *
 * NON append-only : un alias se corrige et se retire. Une erreur qu'on ne
 * pourrait pas défaire mettrait un mauvais prix sur tous les devis suivants.
 */
export const catalogueAliasTable = pgTable(
  "catalogue_alias",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    /** Normalisé par la MÊME fonction que le rapprochement. */
    aliasNormalise: text("alias_normalise").notNull(),
    /** Ce que l'artisan a réellement dit, pour le lui montrer. */
    libelleDicte: text("libelle_dicte").notNull(),
    catalogueLigneId: text("catalogue_ligne_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("catalogue_alias_tenant_idx").on(t.tenantId, t.aliasNormalise),
    unique("catalogue_alias_unique").on(t.tenantId, t.aliasNormalise),
  ],
);

export type CatalogueAlias = typeof catalogueAliasTable.$inferSelect;
