import { pgTable, text, timestamp, uuid, integer, date, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { campagnesRelanceTable } from "./campagnes_relance";

/**
 * Appels de relance passés (ticket 4.18, US-5/US-6/US-8).
 *
 * Une ligne par TENTATIVE : la politique de rappel ne se compte pas autrement,
 * et l'US-5 demande de savoir après combien d'essais un débiteur est déclaré
 * injoignable.
 *
 * PAS DE COLONNE AUDIO, et c'est la garantie : le §6 du ticket tranche
 * « transcription seule, pas de conservation d'audio ». Une colonne absente
 * tient mieux qu'une consigne.
 *
 * EFFAÇABLE, contrairement à `journal_decisions` : c'est une donnée
 * personnelle, pas une preuve. L'US-8 exige que l'effacement d'un contact
 * emporte ses appels, transcriptions et promesses.
 */
export const appelsRelanceTable = pgTable(
  "appels_relance",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    campagneId: text("campagne_id").notNull().references(() => campagnesRelanceTable.id),

    /** Nullable : le client a pu être supprimé, l'appel doit rester comptable. */
    clientId: text("client_id"),
    factureId: text("facture_id"),
    /** Empreinte SALÉE du numéro — jamais le numéro en clair. */
    empreinteNumero: text("empreinte_numero").notNull(),

    tentative: integer("tentative").notNull().default(1),

    statut: text("statut").notNull().default("PLANIFIE"),
    /** Issue MÉTIER (US-6) — nulle tant qu'aucune conversation n'a eu lieu. */
    issue: text("issue"),

    promesseMontantCents: integer("promesse_montant_cents"),
    /** Jour calendaire, pas un instant : une promesse se tient un jour donné. */
    promesseDate: date("promesse_date"),

    transcription: text("transcription"),
    resume: text("resume"),

    /**
     * Condensat SHA-256 du jeton de service du worker — jamais le jeton.
     *
     * Le worker est une machine : il n'a pas de session. Ce condensat permet à
     * la policy `appels_relance_worker_lookup` de résoudre le tenant DEPUIS le
     * jeton, au lieu de le recevoir dans le corps de la requête — ce que la
     * règle 1 interdit.
     *
     * Ne jamais projeter cette colonne dans une réponse : c'est le seul secret
     * de la table.
     */
    jetonSha256: text("jeton_sha256"),

    /**
     * Identifiant de conversation chez la plateforme d'exécution vocale
     * (ticket 4.18-bis). Écrit au déclenchement, lu par le webhook post-call
     * pour raccrocher transcription, issue et coût à cette ligne.
     */
    conversationId: text("conversation_id"),

    /** Millièmes de centime — arrondir au centime fausserait la somme. */
    coutMillicents: integer("cout_millicents").notNull().default(0),

    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("appels_relance_campagne_idx").on(t.tenantId, t.campagneId),
    index("appels_relance_empreinte_idx").on(t.tenantId, t.empreinteNumero),
  ],
);

export type AppelRelance = typeof appelsRelanceTable.$inferSelect;
