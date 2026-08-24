/**
 * Grille tarifaire — vocabulaire partagé entre l'API et l'écran Abonnement.
 *
 * Les PRIX ne vivent pas ici : ils sont seedés par la migration 065 dans la
 * table `plans`, seule source autorisée. Ce module ne porte que ce qui doit
 * être identique des deux côtés du fil : identifiants, statuts, seuil
 * d'alerte, et la clé de mois calendaire.
 */

export const PLAN_IDS = ["fondateurs", "solo", "equipe"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const MODULE_VOCAL_ID = "module_vocal";

export const STATUTS_ABONNEMENT = ["TRIAL", "ACTIVE", "READONLY"] as const;
export type StatutAbonnement = (typeof STATUTS_ABONNEMENT)[number];

export const PERIODICITES = ["MENSUEL", "ANNUEL"] as const;
export type Periodicite = (typeof PERIODICITES)[number];

/** Durée de l'essai, toutes fonctionnalités, limites Équipe, sans carte. */
export const ESSAI_JOURS = 14;

/** L'alerte d'usage vocal part à ce pourcentage des appels inclus — une fois. */
export const SEUIL_ALERTE_USAGE_PCT = 80;

/**
 * Mois calendaire commercial d'un produit français : l'heure de PARIS, pas
 * celle du serveur. Un appel passé le 31 juillet à 23 h 30 heure de Paris
 * appartient à juillet, que le serveur tourne en UTC ou à Auckland — c'est
 * exactement le genre de défaut que la matrice de fuseaux de la CI traque.
 */
export function moisCalendaireParis(d: Date): string {
  // en-CA rend YYYY-MM-DD, le seul format localisé qui se découpe sans regex.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .slice(0, 7);
}

/**
 * Qui compte dans la limite d'utilisateurs d'un plan : les gens qui
 * TRAVAILLENT dans l'espace (OWNER, MEMBER). Le comptable et le tiers en
 * lecture seule sont des accès externes — les compter pousserait un artisan
 * à retirer son comptable pour inviter un salarié.
 */
export const ROLES_COMPTES_DANS_LA_LIMITE = ["OWNER", "MEMBER"] as const;

/**
 * Inviter (qui que ce soit, comptable compris) est une capacité d'Équipe —
 * Solo est « 1 utilisateur, le dirigeant ». Fondateurs contient tout Équipe,
 * et l'essai s'exerce aux limites d'Équipe.
 */
export function planPermetInvitation(planId: string): boolean {
  return planId !== "solo";
}
