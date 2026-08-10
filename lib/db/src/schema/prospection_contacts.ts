import { pgTable, text, timestamp, uuid, date, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Contacts de prospection — TABLE DISTINCTE DE `clients`.
 *
 * La conservation impose de purger les contacts de prospection sans
 * interaction depuis trois ans. Purger `clients` supprimerait de vrais
 * clients, dont les factures doivent survivre.
 *
 * Les propres clients de l'artisan y figurent avec un `clientId` : le lien
 * permet de retrouver la fiche, la ligne permet de prospecter sans toucher au
 * fichier client.
 */
export const contactsProspectionTable = pgTable(
  "contacts_prospection",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    clientId: text("client_id"),
    nom: text("nom").notNull(),
    type: text("type").notNull(),
    email: text("email"),
    telephone: text("telephone"),
    adresse: text("adresse"),
    codePostal: text("code_postal"),
    ville: text("ville"),
    siret: text("siret"),
    origine: text("origine"),
    derniereInteractionLe: date("derniere_interaction_le"),
    /** CONDENSAT du jeton d'opposition — jamais le jeton. */
    oppositionTokenSha256: text("opposition_token_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("contacts_prospection_tenant_idx").on(t.tenantId, t.type)],
);

export type ContactProspection = typeof contactsProspectionTable.$inferSelect;

/**
 * Bases légales — APPEND-ONLY, imposé par le moteur.
 *
 * Une base légale ne se réécrit pas : un changement est une nouvelle ligne.
 * C'est ce journal qui tient le jour d'un contrôle.
 */
export const contactBasesTable = pgTable(
  "contact_bases",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    contactId: text("contact_id").notNull(),
    contactType: text("contact_type").notNull(),
    base: text("base").notNull(),
    /** D'où vient la donnée, en clair. L'article 14 impose de pouvoir le dire. */
    source: text("source").notNull(),
    /** La formulation exacte acceptée, pour un consentement. */
    texteExact: text("texte_exact"),
    obtenueLe: date("obtenue_le").notNull(),
    /** Information de l'article 14. `null` = pas encore informée. */
    informeeLe: date("informee_le"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contact_bases_tenant_contact_idx").on(t.tenantId, t.contactId)],
);

export type ContactBase = typeof contactBasesTable.$inferSelect;

/**
 * Oppositions — APPEND-ONLY.
 *
 * L'opposition porte sur une EMPREINTE de l'e-mail ou du téléphone, salée par
 * tenant, et NON sur l'identifiant du contact : un fichier réimporté crée de
 * nouvelles lignes, et une opposition rattachée à l'identifiant ressusciterait
 * la personne au premier réimport. C'est la personne qu'on a exclue, pas la
 * ligne.
 */
export const oppositionsTable = pgTable(
  "oppositions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    empreinte: text("empreinte").notNull(),
    nature: text("nature").notNull(),
    origine: text("origine").notNull().default("lien"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oppositions_tenant_empreinte_idx").on(t.tenantId, t.empreinte)],
);

export type Opposition = typeof oppositionsTable.$inferSelect;
