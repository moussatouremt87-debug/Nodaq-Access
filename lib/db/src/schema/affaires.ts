import { integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const affairesTable = pgTable("affaires", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
  reference: text("reference"),
  label: text("label").notNull(),
  clientName: text("client_name"),
  status: text("status").notNull().default("PROSPECT"),
  quotedAmountCents: integer("quoted_amount_cents"),
  invoicedAmountCents: integer("invoiced_amount_cents"),
  marginCents: integer("margin_cents"),
  notes: text("notes"),
  startDate: text("start_date"),
  completedAt: text("completed_at"),
  /** Montant vendu HT en centimes (issu du devis signé ou de la reprise) */
  montantVenduHt: integer("montant_vendu_ht"),
  /** Avancement en % (0-100), null = non renseigné */
  avancementPct: real("avancement_pct"),
  /** Date de fin prévisionnelle (ISO YYYY-MM-DD) */
  dateFinPrevue: text("date_fin_prevue"),
  /** Origine du chantier : DEVIS | DIRECT | RECOMMANDATION | APPEL_OFFRE */
  origine: text("origine"),
  /**
   * Lien vers la fiche client. NULLABLE, et le nom en clair de cette table
   * reste la valeur AFFICHÉE sur un document émis : le texte est un
   * instantané, `clientId` est le lien. Renommer une fiche ne doit pas
   * réécrire un document déjà imprimé.
   */
  clientId: text("client_id"),
  /** JSON: type[] d'habilitations requises (US-A4.4) — voir team_member_habilitations.type. */
  habilitationsRequises: text("habilitations_requises").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAffaireSchema = createInsertSchema(affairesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAffaire = z.infer<typeof insertAffaireSchema>;
export type Affaire = typeof affairesTable.$inferSelect;
