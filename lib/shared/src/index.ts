import { z } from "zod";

/** UUID v4 (identifiants de toutes les entités). */
export const Uuid = z.string().uuid();
export type Uuid = z.infer<typeof Uuid>;

/**
 * Identifiant de tenant. Toute frontière de données (header, payload, outil MCP)
 * qui transporte un tenant DOIT valider avec ce schéma.
 */
export const TenantId = Uuid;
export type TenantId = z.infer<typeof TenantId>;

/**
 * Roles within a tenant, stored as plain text in `memberships.role` (custom
 * session-based auth, not a third-party organization plugin — no such
 * dependency exists in this repo). `ACCOUNTANT` = delegated financial access
 * (expert-comptable) — see `FINANCIAL_ROLES` below.
 *
 * UPPERCASE, matching the actual DB default (`memberships.ts`) and every
 * consumer (`requireRole.ts`, `authService.ts`, the frontend `useAuth`
 * hook) — this file previously declared a lowercase variant that nothing
 * imported. One casing, read from here, not two hand-maintained lists.
 */
export const MembershipRole = z.enum(["OWNER", "MEMBER", "ACCOUNTANT"]);
export type MembershipRole = z.infer<typeof MembershipRole>;

/**
 * Qui voit les données financières. `OWNER` et `ACCOUNTANT` — pas `MEMBER`.
 * Source unique : le backend (composition des routeurs) et le frontend (HOC
 * de route, filtre de nav) lisent tous les deux CETTE liste, jamais une
 * copie maintenue à la main de chaque côté.
 */
export const FINANCIAL_ROLES = ["OWNER", "ACCOUNTANT"] as const satisfies readonly MembershipRole[];

export function hasFinancialAccess(role: string | null | undefined): boolean {
  return (FINANCIAL_ROLES as readonly string[]).includes(role ?? "");
}

/** Payload de création d'une note (démo du pattern « table métier scellée par RLS »). */
export const CreateNoteInput = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(10_000),
});
export type CreateNoteInput = z.infer<typeof CreateNoteInput>;

/**
 * Data sensitivity category (CLAUDE.md rule #1 — sovereignty).
 * Drives model-tier routing: `confidentiel` NEVER leaves the sovereign tier.
 */
export const SensitivityCategory = z.enum(["confidentiel", "interne", "non_sensible"]);
export type SensitivityCategory = z.infer<typeof SensitivityCategory>;

/** LiteLLM model groups. `frontier` is the only non-sovereign tier (tenant opt-in). */
export const ModelGroup = z.enum([
  "confidential",
  "sovereign-strong",
  "sovereign-fast",
  "frontier",
  "embeddings",
]);
export type ModelGroup = z.infer<typeof ModelGroup>;

/** Invariant runtime : jette si la condition est fausse (narrowing TypeScript). */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}
export * from "./frenchTax.js";
export * from "./depreciation.js";
export * from "./capex.js";
export * from "./regulatoryWatch.js";
export * from "./dataCatalog.js";
export * from "./taxCalendar.js";
export * from "./rgpdRegister.js";
export * from "./prospection.js";
export * from "./canauxProspection.js";
export * from "./axesProspection.js";
export * from "./cpvBatiment.js";
export * from "./secteursMarchesPublics.js";
export * from "./costCategories.js";
export * from "./receivableAccounts.js";
export * from "./moduleCatalog.js";
export * from "./pendingActionCatalog.js";
export * from "./affaireMargin.js";
export * from "./coutMainOeuvre.js";
export * from "./rapprochementCatalogue.js";
export * from "./intentionVocale.js";
export * from "./reglagesObjectifs.js";
export * from "./envoiDomaine.js";
export * from "./objectifsCockpit.js";
export * from "./verticalPacks.js";
export * from "./recurrence.js";
export * from "./revenusAcquis.js";
export * from "./conversationRetention.js";
export * from "./freshnessRules.js";
export * from "./dates.js";
