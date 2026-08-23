import { boolean, integer, json, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export type FactureAddress = {
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
};

export type FactureLine = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  /** TVA rate in % — 20 | 10 | 5.5 | 2.1 | 0 */
  vatRate: number;
  /** UNTDID 5305 VAT category */
  vatCategory: "S" | "Z" | "E" | "AE";
  unit?: string;
};

/** Statut de la facture — une facture EMISE est immuable. */
export type FactureStatut = "BROUILLON" | "EMISE" | "PAYEE" | "ANNULEE_PAR_AVOIR";

export const facturesTable = pgTable("factures", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),

  // ── Legacy columns (kept for backward compat) ─────────────────────────
  customerName: text("customer_name").notNull(),
  /** Sequential invoice number, set at emission: FACT-YYYY-NNNN. Null = brouillon. */
  number: text("number").notNull(),
  issuedDate: text("issued_date").notNull(),
  dueDate: text("due_date").notNull(),
  /** Total TTC in (real) cents — kept for backward compat. */
  amountCents: integer("amount_cents").notNull(),
  residualCents: integer("residual_cents"),
  /** Kept for backward compat; PAYEE statut is authoritative. */
  settled: boolean("settled").notNull().default(false),
  affaireId: text("affaire_id"),
  /**
   * Le devis facturé, s'il y en a un. UNIQUE en base (migration 049) : un
   * devis ne se facture qu'une fois, et c'est le MOTEUR qui le tient — un
   * contrôle applicatif « ce devis a-t-il déjà une facture ? » se contourne
   * par deux requêtes simultanées, qui lisent « non » toutes les deux.
   */
  devisId: text("devis_id"),

  // ── New columns ────────────────────────────────────────────────────────
  /** Authoritative status. Immutability: EMISE → never PATCH/DELETE. */
  statut: text("statut").notNull().default("BROUILLON"),
  /** Detailed lines with TVA per line */
  lines: json("lines").$type<FactureLine[]>().notNull().default([]),
  /** Total HT in integer cents (computed from lines) */
  totalHTCents: integer("total_ht_cents").notNull().default(0),
  /** Total TVA in integer cents */
  totalTVACents: integer("total_tva_cents").notNull().default(0),
  /** Client billing address */
  clientAddress: json("client_address").$type<FactureAddress>(),
  /** Work-site address */
  chantierAddress: json("chantier_address").$type<FactureAddress>(),
  /** Reverse-charge VAT (autoliquidation — art. 283-2 nonies CGI) */
  autoliquidation: boolean("autoliquidation").notNull().default(false),
  /** Signed attestation TVA réduite provided by client (required for reduced-rate lines) */
  attestationTvaFournie: boolean("attestation_tva_fournie").notNull().default(false),
  /** Path to the archived PDF file (relative to STORAGE_DIR) */
  pdfPath: text("pdf_path"),
  /** SHA-256 hex of the archived PDF */
  pdfSha256: text("pdf_sha256"),
  /** ID of the avoir that cancelled this facture */
  avoirId: text("avoir_id"),

  /**
   * Lien vers la fiche client. NULLABLE, et le nom en clair de cette table
   * reste la valeur AFFICHÉE sur un document émis : le texte est un
   * instantané, `clientId` est le lien. Renommer une fiche ne doit pas
   * réécrire un document déjà imprimé.
   */
  clientId: text("client_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFactureSchema = createInsertSchema(facturesTable).omit({ id: true, createdAt: true });
export type InsertFacture = z.infer<typeof insertFactureSchema>;
export type Facture = typeof facturesTable.$inferSelect;
