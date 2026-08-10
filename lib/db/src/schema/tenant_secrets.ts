import { pgTable, text, timestamp, integer, uuid, primaryKey } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Magasin de secrets chiffrés — un seul, pour tout le produit.
 *
 * Ce qui entre ici : ce qui OUVRE UN ACCÈS chez un tiers (mot de passe SMTP,
 * jeton d'un connecteur). Aucune donnée client. Le chiffrement se fait dans
 * l'application (`@nodaq/crypto`, AES-256-GCM) : la base ne voit que du
 * chiffré et ne connaît aucune clé.
 *
 * Pas d'`id` : la clé primaire est `(tenant_id, cle)`. Le tenant fait donc
 * partie de l'identité de la ligne ET de l'AAD du chiffrement — deux barrières
 * indépendantes contre le mélange de secrets entre clients.
 *
 * Pas d'index sur `valeurChiffree`, et il ne faut pas en ajouter : l'IV étant
 * tiré au sort, deux chiffrements de la même valeur diffèrent. Un index
 * d'unicité ne refuserait rien, un index de recherche ne trouverait rien.
 *
 * Table NON append-only, contrairement à `envois_journal` et `archived_pdfs` :
 * un secret se remplace et se révoque.
 */
export const tenantSecretsTable = pgTable(
  "tenant_secrets",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    /** Clé logique : « envoi.smtp_password », « connecteur.<id>.<champ> ». */
    cle: text("cle").notNull(),
    /** « v1:<version_cle>:<iv_b64>:<tag_b64>:<chiffre_b64> ». Jamais journalisé. */
    valeurChiffree: text("valeur_chiffree").notNull(),
    /** Combien de fois CE chiffré a été re-clé. Donnée d'inventaire. */
    versionCle: integer("version_cle").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.cle] })],
);

export type TenantSecret = typeof tenantSecretsTable.$inferSelect;

/** Clé logique du mot de passe SMTP de l'artisan. Une seule écriture possible. */
export const CLE_SMTP_PASSWORD = "envoi.smtp_password";

/** Préfixe des secrets d'un connecteur : `connecteur.<id>.<champ>`. */
export function cleConnecteur(connecteurId: string, champ: string): string {
  return `connecteur.${connecteurId}.${champ}`;
}
