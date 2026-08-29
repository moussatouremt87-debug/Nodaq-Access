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
export const MembershipRole = z.enum(["OWNER", "MEMBER", "ACCOUNTANT", "VIEWER"]);
export type MembershipRole = z.infer<typeof MembershipRole>;

/**
 * Qui voit les données financières — `MEMBER` excepté.
 * Source unique : le backend (composition des routeurs) et le frontend (HOC
 * de route, filtre de nav) lisent tous les deux CETTE liste, jamais une
 * copie maintenue à la main de chaque côté.
 *
 * `VIEWER` (US-A5.4) y figure DÉLIBÉRÉMENT, et c'est le point le moins
 * évident du dessin : ce qu'il montre au tiers de confiance, ce sont les
 * MONTANTS EN CLAIR (`hasFinancialAccess` pilote `maskFinancialFields`) et
 * l'exigence du second facteur (`requireMfaVerified` lit le même prédicat).
 * Ce n'est PAS ce qui décide des écrans qu'il atteint — deux dimensions
 * distinctes : cette liste dit « voit les montants », `ECRANS_TIERS_LECTURE`
 * ci-dessous dit « atteint cet écran », et rétrécit ensuite ce que celle-ci
 * ouvrirait.
 */
export const FINANCIAL_ROLES = ["OWNER", "ACCOUNTANT", "VIEWER"] as const satisfies readonly MembershipRole[];

export function hasFinancialAccess(role: string | null | undefined): boolean {
  return (FINANCIAL_ROLES as readonly string[]).includes(role ?? "");
}

/**
 * Tiers de confiance en lecture seule (US-A5.4) — un banquier qui instruit un
 * dossier de prêt, un repreneur en cours d'audit. Il ne peut RIEN écrire, et
 * son accès porte une échéance (`memberships.expires_at`).
 */
export function estLectureSeule(role: string | null | undefined): boolean {
  return role === "VIEWER";
}

/**
 * Les SEULS écrans qu'un `VIEWER` atteint — préfixes de chemin d'API, et par
 * ricochet entrées de navigation côté frontend (source unique, lue des deux
 * côtés comme `FINANCIAL_ROLES`).
 *
 * LISTE BLANCHE, jamais liste noire : un routeur ajouté demain est refusé par
 * défaut. Une liste noire fuirait au premier oubli — et l'oubli est
 * silencieux, ce qui est exactement le mode de défaillance qu'on ne peut pas
 * se permettre sur un accès accordé à quelqu'un d'extérieur à l'entreprise.
 *
 * Le dossier financier, donc : pas le pipeline de prospects, pas les échanges
 * avec l'assistant, pas le classeur. Un banquier instruit des comptes, il
 * n'audite pas l'activité commerciale.
 */
export const ECRANS_TIERS_LECTURE = [
  "/cockpit",
  "/compte-resultat",
  "/factures",
  "/marge",
  "/rapports",
  "/echeances",
  "/previsionnel-tresorerie",
  // Le SECTEUR du tenant, rien d'autre — aucune donnée financière ni
  // opérationnelle. Sans lui, `useVertical()` retombe sur le vocabulaire par
  // défaut et le tiers lit « affaires » là où l'artisan lit « chantiers » :
  // deux libellés pour un même écran, sur un dossier qu'ils regardent
  // ensemble. L'écriture reste fermée par la garde de méthode.
  "/votre-metier",
] as const;

/**
 * Les écrans d'API ouverts au COMPTABLE.
 *
 * ── POURQUOI CETTE LISTE EXISTE ─────────────────────────────────────────────
 * `ACCOUNTANT` figure dans `FINANCIAL_ROLES` — il voit donc les montants — mais
 * RIEN ne limitait les écrans qu'il atteint. Il avait exactement ceux d'un
 * patron : la prospection, l'équipe, les paramètres, et l'écran d'envoi des
 * documents, qui porte le mot de passe SMTP du tenant.
 *
 * Constaté par le fondateur le 29/08/2026, sur son propre accès comptable.
 *
 * ── CE QU'UN COMPTABLE A BESOIN DE VOIR ─────────────────────────────────────
 * Ce qu'il saisit et ce qu'il exporte : les produits (factures, avoirs), les
 * charges, les justificatifs du classeur, le compte de résultat qu'il
 * alimente, l'échéancier fiscal, et l'export FEC.
 *
 * La MARGE et le PRÉVISIONNEL y figurent par décision du fondateur : son
 * cabinet fait du conseil de gestion, pas seulement de la tenue de comptes.
 * Ce n'est pas une règle générale du produit — c'est un choix, et il se
 * change ici.
 *
 * LISTE BLANCHE, jamais liste noire — même raison que pour le tiers de
 * confiance : un routeur ajouté demain est refusé par défaut, et un oubli de
 * liste noire est silencieux.
 */
export const ECRANS_COMPTABLE = [
  "/cockpit",
  "/compte-resultat",
  "/factures",
  "/avoirs",
  "/charges-recurrentes",
  "/classeur",
  "/echeances",
  "/rapports",
  "/activity",
  "/marge",
  "/previsionnel-tresorerie",
  /*
   * Ajoutés APRÈS coup, et l'omission est instructive : une garde existante
   * (`acces-financier-membres.test.ts`) exigeait déjà que le comptable
   * atteigne ces trois routes, et ma première liste les fermait.
   *
   * Une restriction TROP LARGE est un défaut au même titre qu'une trop
   * étroite — moins visible, car elle ne fuit rien, mais elle empêche le
   * comptable de travailler. `/analytics/indicateurs` alimente le Cockpit et
   * la Marge que je venais d'ouvrir : fermer la source en ouvrant l'écran
   * aurait donné une page vide sans que rien ne l'explique.
   */
  "/analytics",
  "/paiements",
  "/contrats",
  // Le secteur du tenant, pour que les libellés soient les mêmes des deux
  // côtés — même raison que pour le tiers de confiance.
  "/votre-metier",
] as const;

/**
 * Le périmètre d'API d'un rôle, ou `undefined` quand il n'en a aucun.
 *
 * UNE SEULE CARTE, consultée par un seul point d'application. Écrire un
 * second middleware pour le comptable aurait produit une troisième
 * implémentation du même contrôle — ce dépôt a déjà payé trois fois ce
 * travers, et à chaque fois les copies ont divergé.
 *
 * `OWNER` et `MEMBER` n'y figurent pas : le premier voit tout, le second est
 * borné par `FINANCIAL_ROLES` (les montants) et par les droits d'écriture,
 * pas par une liste d'écrans.
 */
export const PERIMETRE_API_PAR_ROLE: Partial<Record<MembershipRole, readonly string[]>> = {
  VIEWER: ECRANS_TIERS_LECTURE,
  ACCOUNTANT: ECRANS_COMPTABLE,
};

/**
 * Ce chemin d'API est-il ouvert à ce rôle ?
 *
 * Un rôle sans périmètre déclaré passe : c'est le cas d'`OWNER`. L'absence de
 * restriction est donc EXPLICITE dans la carte, jamais un effet de bord d'une
 * condition oubliée.
 */
export function cheminOuvertAuRole(role: string | null | undefined, chemin: string): boolean {
  const perimetre = PERIMETRE_API_PAR_ROLE[role as MembershipRole];
  if (!perimetre) return true;
  return perimetre.some((prefixe) => chemin === prefixe || chemin.startsWith(`${prefixe}/`));
}

/**
 * Les ROUTES du SPA ouvertes au comptable — le pendant de `ECRANS_COMPTABLE`.
 *
 * Deux listes et non une, pour la même raison que côté tiers de confiance :
 * les chemins d'API et les routes d'écran ne coïncident pas. L'échéancier
 * fiscal en est l'exemple — l'écran est `/echeancier`, la route d'API
 * `/echeances`.
 *
 * Celle-ci ne PROTÈGE rien : elle évite d'afficher un lien qui répondrait 403.
 * La protection est côté serveur (`PERIMETRE_API_PAR_ROLE`), parce qu'une URL
 * reste tapable quoi qu'affiche le menu.
 */
export const ROUTES_COMPTABLE = [
  "/",
  "/cockpit",
  "/compte-resultat",
  "/factures",
  "/avoirs",
  "/charges-recurrentes",
  "/classeur",
  "/echeancier",
  "/rapports",
  "/activite",
  "/marge",
  "/previsionnel-tresorerie",
  "/contrats",
  "/votre-metier",
] as const;

/** Vrai si cette route d'écran est ouverte au comptable. */
export function routeOuverteAuComptable(route: string): boolean {
  if (route === "/") return true;
  return ROUTES_COMPTABLE.some(
    (prefixe) => prefixe !== "/" && (route === prefixe || route.startsWith(`${prefixe}/`)),
  );
}

/** Vrai si ce chemin d'API est ouvert au tiers de confiance en lecture seule. */
export function cheminOuvertEnLectureSeule(chemin: string): boolean {
  return ECRANS_TIERS_LECTURE.some(
    (prefixe) => chemin === prefixe || chemin.startsWith(`${prefixe}/`),
  );
}

/**
 * Le PENDANT de `ECRANS_TIERS_LECTURE` côté navigation : les routes du SPA
 * qu'un `VIEWER` peut ouvrir. Deux listes et pas une, parce que les deux
 * espaces de nommage ne coïncident pas — le cockpit est servi par
 * `/cockpit/*` mais affiché à `/`, l'échéancier lit `/echeances` mais vit à
 * `/echeancier`. Les dériver l'une de l'autre demanderait une table de
 * correspondance qui serait, elle aussi, à tenir à jour.
 *
 * Déclarées CÔTE À CÔTE, dans ce fichier, précisément pour qu'on ne puisse
 * pas en modifier une en oubliant l'autre. Ajouter un écran au dossier
 * financier, c'est toucher aux deux, ici, en même temps.
 *
 * Ce n'est PAS ce qui protège les données : le serveur refuse tout ce qui
 * sort de `ECRANS_TIERS_LECTURE`, indépendamment de cette liste-ci. Celle-ci
 * évite seulement d'afficher au tiers des entrées de menu qui le mèneraient
 * à un écran vide.
 */
export const ROUTES_TIERS_LECTURE = [
  "/",
  "/compte-resultat",
  "/factures",
  "/marge",
  "/rapports",
  "/echeancier",
  "/previsionnel-tresorerie",
] as const;

/** Vrai si cette route du SPA est ouverte au tiers de confiance. */
export function routeOuverteEnLectureSeule(route: string): boolean {
  if (route === "/") return true;
  return ROUTES_TIERS_LECTURE.some(
    (prefixe) => prefixe !== "/" && (route === prefixe || route.startsWith(`${prefixe}/`)),
  );
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
export * from "./conformiteFacturation.js";
export * from "./gestionDechets.js";
export * from "./qualificationOnboarding.js";
export * from "./qrVirement.js";
export * from "./etatInvitation.js";
export * from "./evalAgent.js";
export * from "./couvertureSectorielle.js";
export * from "./facturationTemps.js";
export * from "./facturationRecurrente.js";
export * from "./productionVendue.js";
export * from "./perimetreSante.js";
export * from "./attestationSap.js";
export * from "./glossaire.js";
export * from "./relanceCommerciale.js";
export * from "./relanceFacture.js";
export * from "./intentionVocale.js";
export * from "./montantDicte.js";
export * from "./tempsGagne.js";
export * from "./reglagesObjectifs.js";
export * from "./envoiDomaine.js";
export * from "./objectifsCockpit.js";
export * from "./verticalPacks.js";
export * from "./recurrence.js";
export * from "./revenusAcquis.js";
export * from "./conversationRetention.js";
export * from "./freshnessRules.js";
export * from "./dates.js";
export * from "./iban.js";
export * from "./previsionnelTresorerie.js";
export * from "./companyProfile.js";
export * from "./retardPaiement.js";
export * from "./capaciteEquipe.js";
export * from "./habilitations.js";
export * from "./souverainete.js";
export * from "./mandatNegociation.js";
export * from "./decisionAppel.js";
export * from "./oralite.js";
export * from "./formulation.js";
export * from "./fenetreAppel.js";
export * from "./tarification.js";
