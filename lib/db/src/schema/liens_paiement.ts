import { pgTable, text, timestamp, uuid, integer, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { appelsRelanceTable } from "./appels_relance";

/**
 * Liens de paiement émis après un appel de relance (ticket 4.19).
 *
 * Une promesse verbale n'engage rien ; un lien de paiement la rend exécutable
 * dans la minute. Cette table trace l'ÉMISSION et la vie du lien — pas
 * l'encaissement, qui s'écrit dans `paiements` (append-only, tenu par le
 * moteur) au retour du webhook Bridge. Un lien émis n'est pas un euro reçu.
 *
 * `montantCents` est FIGÉ à l'émission : il vient de la facture ou de la
 * promesse enregistrée, jamais du modèle (règle 3), et le relire plus tard
 * laisserait un lien changer de montant entre son envoi et son règlement.
 *
 * AUCUNE coordonnée en clair — l'empreinte salée suffit à rapprocher et à
 * effacer sur la coordonnée (US-8), et ne permet pas de composer.
 */
export const liensPaiementTable = pgTable(
  "liens_paiement",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),

    /** L'appel d'origine. Nullable : le même mécanisme servira sans appel. */
    appelId: text("appel_id").references(() => appelsRelanceTable.id),
    factureId: text("facture_id"),
    clientId: text("client_id"),
    /** Empreinte SALÉE du destinataire — jamais le numéro en clair. */
    empreinteNumero: text("empreinte_numero").notNull(),

    montantCents: integer("montant_cents").notNull(),

    bridgeLinkId: text("bridge_link_id"),
    /**
     * L'identifiant de transaction de Bridge, posé au retour du webhook.
     * UNIQUE en base : c'est LUI qui tient l'idempotence. Leur webhook rejoue,
     * `paiements` est append-only — un doublon y écrirait un encaissement qui
     * n'a jamais eu lieu.
     */
    bridgeTransactionId: text("bridge_transaction_id"),
    /**
     * URL publique du lien Bridge. VOLUMINEUSE : ne jamais la ramener dans
     * une route de liste sans projection — même doctrine qu'`archived_pdfs`.
     */
    url: text("url"),

    statut: text("statut").notNull().default("EMIS"),

    expireLe: timestamp("expire_le", { withTimezone: true }),
    payeLe: timestamp("paye_le", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("liens_paiement_tenant_idx").on(t.tenantId, t.createdAt),
    index("liens_paiement_appel_idx").on(t.tenantId, t.appelId),
    index("liens_paiement_empreinte_idx").on(t.tenantId, t.empreinteNumero),
  ],
);

/** Les statuts de vie d'un lien. `PAYE` n'est posé que par le webhook Bridge. */
export const STATUTS_LIEN_PAIEMENT = ["EMIS", "PAYE", "EXPIRE", "REVOQUE", "ECHEC"] as const;
export type StatutLienPaiement = (typeof STATUTS_LIEN_PAIEMENT)[number];
