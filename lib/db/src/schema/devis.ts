import { pgTable, text, timestamp, integer, real, json, uuid, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import type { GestionDechets } from "@nodaq/shared";

export type DevisAddress = {
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
};

export type DevisLine = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  /** TVA rate in % — 20 | 10 | 5.5 | 2.1 | 0. Defaults to 20 if absent (legacy rows). */
  vatRate?: number;
  /** UNTDID 5305 category — S standard, Z zero, E exempt, AE reverse charge. */
  vatCategory?: "S" | "Z" | "E" | "AE";
  /** Unit of measure (optional). */
  unit?: string;
};

export const devisTable = pgTable("devis", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  reference: text("reference").notNull(),
  clientName: text("client_name").notNull(),
  status: text("status").notNull().default("BROUILLON"),
  lines: json("lines").$type<DevisLine[]>().notNull().default([]),
  /** Total HT in integer cents */
  totalHTCents: integer("total_ht_cents").notNull().default(0),
  /** Total TTC in integer cents */
  totalTTCCents: integer("total_ttc_cents").notNull().default(0),
  /** Legacy single VAT rate — kept for backward compat, per-line vatRate takes precedence. */
  tvaRate: real("tva_rate").notNull().default(20),
  remise: real("remise").notNull().default(0),
  notes: text("notes"),
  validUntil: text("valid_until"),
  affaireId: text("affaire_id"),
  /** Client billing address */
  clientAddress: json("client_address").$type<DevisAddress>(),
  /** Work-site address (adresse du chantier) */
  chantierAddress: json("chantier_address").$type<DevisAddress>(),
  /** Reverse-charge VAT (autoliquidation — art. 283-2 nonies CGI) */
  autoliquidation: boolean("autoliquidation").notNull().default(false),
  /** Retention guarantee percentage (retenue de garantie) */
  retenueGarantiePct: real("retenue_garantie_pct").notNull().default(0),
  /**
   * CONDENSAT SHA-256 du jeton d'acceptation publique — jamais le jeton.
   *
   * Le jeton ne vit que dans le lien envoyé au client. Le conserver en clair
   * faisait de la base une preuve d'engagement falsifiable : qui lit une
   * sauvegarde ou un réplica pouvait accepter un devis à la place du client.
   */
  acceptTokenSha256: text("accept_token_sha256"),
  /** When the devis was accepted via the public page */
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  /** Signataire name captured on the acceptance page */
  acceptedBy: text("accepted_by"),
  /** Client IP captured on the acceptance page */
  acceptedIp: text("accepted_ip"),
  /** When the devis was emailed to the client */
  dateEnvoi: timestamp("date_envoi", { withTimezone: true }),
  /**
   * Lien vers la fiche client. NULLABLE, et le nom en clair de cette table
   * reste la valeur AFFICHÉE sur un document émis : le texte est un
   * instantané, `clientId` est le lien. Renommer une fiche ne doit pas
   * réécrire un document déjà imprimé.
   */
  clientId: text("client_id"),
  /** Dernière relance PROPOSÉE pour ce devis — évite de le reproposer. */
  derniereRelanceLe: text("derniere_relance_le"),
  /**
   * Bloc de gestion des déchets (loi AGEC, décret 2020-1817).
   *
   * `null` = non applicable (secteur hors travaux) ou devis antérieur au
   * ticket 4.35 — les devis existants ne sont pas réécrits.
   */
  gestionDechets: json("gestion_dechets").$type<GestionDechets | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDevisSchema = createInsertSchema(devisTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDevis = z.infer<typeof insertDevisSchema>;
export type Devis = typeof devisTable.$inferSelect;
