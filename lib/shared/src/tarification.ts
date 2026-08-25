/**
 * Grille tarifaire — vocabulaire partagé entre l'API et l'écran Abonnement.
 *
 * Les PRIX ne vivent pas ici : ils sont seedés par la migration 065 dans la
 * table `plans`, seule source autorisée. Ce module ne porte que ce qui doit
 * être identique des deux côtés du fil : identifiants, statuts, seuils,
 * jalons d'essai, et la clé de mois calendaire.
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

/**
 * Jalons d'essai (4.43 §5). La carte n'est JAMAIS demandée avant le jour 10
 * (friction fatale pour la cible) ; le message de J10 est une continuité,
 * pas une menace. Le jour 7, si aucune action proposée par l'assistant n'a
 * été validée, un e-mail d'activation part — signé du fondateur.
 */
export const ESSAI_JOUR_DEMANDE_CARTE = 10;
export const ESSAI_JOUR_ACTIVATION = 7;

/** L'alerte d'usage part à ce pourcentage de l'inclus — une fois par mois. */
export const SEUIL_ALERTE_USAGE_PCT = 80;

/** Les usages comptés. Le vocal se compte en DOSSIERS (un impayé relancé
 *  dans le mois, jamais une tentative d'appel — 4.43 §1) ; WhatsApp en
 *  conversations (plafond souple : alerte, jamais de blocage — 4.43 §2). */
export const USAGES = ["vocal", "whatsapp"] as const;
export type Usage = (typeof USAGES)[number];

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
 * Solo est « 1 utilisateur, le dirigeant », et le rôle expert-comptable est
 * un contenu d'Équipe (4.43 §3). Fondateurs contient tout Équipe, et
 * l'essai s'exerce aux limites d'Équipe.
 */
export function planPermetInvitation(planId: string): boolean {
  return planId !== "solo";
}

/**
 * La marge par chantier est un contenu d'Équipe (4.43 §3), y compris en
 * usage mono-utilisateur : c'est le chemin d'upgrade des artisans qui
 * grossissent sans embaucher. En Solo elle est VERROUILLÉE avec un état
 * explicite — jamais un bouton mort. L'essai (limites Équipe) y a accès.
 */
export function planPermetMargeChantier(planId: string): boolean {
  return planId !== "solo";
}

/** Le message de l'état verrouillé — le même à l'API et à l'écran. */
export const MESSAGE_MARGE_EQUIPE =
  "La marge par chantier fait partie de l'offre Équipe — voyez votre marge chantier par chantier. Le changement se fait dans Réglages → Abonnement.";
