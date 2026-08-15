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

/** Clé API de la plateforme agréée (US-A2.6) — lue par lib/plateforme-agreee. */
export const CLE_PA_API_KEY = "plateforme_agreee.api_key";

/**
 * Secret partagé vérifiant un push entrant de la plateforme agréée (US-A2.6).
 * Aucune session utilisateur sur un webhook externe — c'est ce secret, pas
 * `requireAuth`, qui authentifie l'appelant avant résolution du tenant.
 */
export const CLE_PA_WEBHOOK_SECRET = "plateforme_agreee.webhook_secret";

/** Préfixe des secrets d'un connecteur : `connecteur.<id>.<champ>`. */
export function cleConnecteur(connecteurId: string, champ: string): string {
  return `connecteur.${connecteurId}.${champ}`;
}

/**
 * Jeton d'acceptation publique d'un devis : `devis.<id>.accept_token`.
 *
 * C'est un PORTEUR — pas un identifiant chez un tiers — et il a pourtant sa
 * place ici. Le magasin sert à ce qui ouvre un accès et ne doit pas être
 * lisible depuis une sauvegarde ; un jeton qui vaut signature d'un devis entre
 * exactement dans cette définition.
 *
 * Il est chiffré et NON condensé, parce que le renvoi d'un devis doit pouvoir
 * reproduire le MÊME lien : le condensat, lui, reste dans
 * `devis.accept_token_sha256`, où la policy publique le compare par égalité.
 * Les deux coexistent et servent à deux choses différentes — vérifier, et
 * reconstruire.
 */
export function cleJetonDevis(devisId: string): string {
  return `devis.${devisId}.accept_token`;
}
