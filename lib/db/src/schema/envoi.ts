import { pgTable, text, timestamp, uuid, index, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Paramétrage d'envoi, un par tenant.
 *
 * Le sélecteur DKIM et sa valeur sont stockés ICI parce qu'ils sont PROPRES À
 * CHAQUE DOMAINE. La valeur `include:` du SPF, elle, désigne le service d'envoi
 * et est commune à tous les tenants : elle vit dans la configuration, jamais en
 * base. Sans cette séparation, brancher l'enrôlement automatique du domaine
 * demanderait une migration.
 *
 * Aucun secret n'est stocké : la signature DKIM est faite par le fournisseur
 * d'envoi, la clé privée ne transite jamais par ce produit.
 */
export const parametresEnvoiTable = pgTable(
  "parametres_envoi",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    /** 'domaine_authentifie' (principal) | 'repli_nodaq' (repli). */
    mode: text("mode").notNull().default("repli_nodaq"),
    /** Domaine de l'artisan, sans @ ni protocole : « toituremartin.fr ». */
    domaine: text("domaine"),
    emailExpediteur: text("email_expediteur"),
    nomExpediteur: text("nom_expediteur"),
    /** PAR DOMAINE — recopiés depuis la console du service d'envoi. */
    dkimSelecteur: text("dkim_selecteur"),
    dkimValeur: text("dkim_valeur"),
    /** Dernière vérification DNS réussie. `null` = jamais vérifié. */
    verifieLe: timestamp("verifie_le", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("parametres_envoi_unique_tenant").on(t.tenantId)],
);

export type ParametresEnvoi = typeof parametresEnvoiTable.$inferSelect;

export const MODES_ENVOI = ["domaine_authentifie", "repli_nodaq"] as const;
export type ModeEnvoi = (typeof MODES_ENVOI)[number];

/**
 * Journal des envois — append-only.
 *
 * DONNÉE PERSONNELLE : `destinataire` est l'adresse du client de l'artisan.
 * Durée de conservation dans lib/shared (ENVOIS_JOURNAL_RETENTION_DAYS), entrée
 * au registre des traitements.
 *
 * Ni le corps ni le SUJET du message n'y figurent : le sujet d'un devis porte
 * le nom du client et la référence du chantier (CLAUDE.md §6).
 */
export const envoisJournalTable = pgTable(
  "envois_journal",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    destinataire: text("destinataire").notNull(),
    /** 'DEVIS' | 'FACTURE' | 'AVOIR' — le type, jamais le contenu. */
    documentType: text("document_type").notNull(),
    documentId: text("document_id"),
    mode: text("mode").notNull(),
    /** 'envoye' | 'echec'. */
    statut: text("statut").notNull(),
    /** Erreur du serveur SMTP le cas échéant. Jamais le corps du mail. */
    erreur: text("erreur"),
    envoyeLe: timestamp("envoye_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("envois_journal_tenant_date_idx").on(t.tenantId, t.envoyeLe)],
);

export type EnvoiJournal = typeof envoisJournalTable.$inferSelect;
