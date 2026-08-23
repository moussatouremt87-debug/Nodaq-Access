/*
 * Ce qui est déjà outillé pour un secteur, et ce qui ne l'est pas — US-A1.4.
 *
 * ── La contradiction que ce module ferme ──────────────────────────────────
 * US-A1.1 est la story fondatrice : ne pas présumer du secteur. Elle est
 * livrée — trente-quatre métiers, vocabulaire adapté. Mais l'audit du
 * 23/08/2026 a constaté que la liste d'onboarding n'en propose que NEUF, sans
 * porte de sortie : un fleuriste, un agriculteur, un photographe n'y trouve
 * pas son métier et doit en choisir un autre, ou passer l'écran — et le
 * défaut serveur le range alors en `industrie_btp`.
 *
 * Le rebond que A1.1 corrige à l'écran du secteur revenait donc à l'écran
 * suivant, sous une autre forme. Ce module ajoute la porte de sortie ET
 * l'honnêteté qui va avec.
 *
 * ── Pourquoi une promesse EXPLICITE plutôt qu'un silence ──────────────────
 * Le ticket le dit : « promettre implicitement une couverture complète à un
 * secteur non encore livré crée une déception plus coûteuse commercialement
 * qu'une transparence assumée dès le départ ». Un utilisateur qui sait ce
 * qu'il n'aura pas reste ; celui qui le découvre trois semaines plus tard
 * part, et le dit autour de lui.
 */
import type { Vertical } from "./verticalPacks.js";

/**
 * Les secteurs pour lesquels un module DÉDIÉ existe, au-delà du tronc commun.
 *
 * Volontairement COURT et vérifiable. Le bâtiment est le seul aujourd'hui :
 * autoliquidation, retenue de garantie, décennale, signaux de chantier. Y
 * inscrire un secteur dont le module n'existe pas serait exactement la
 * promesse implicite que cette story combat.
 *
 * Le distinguo n'est pas « le vertical existe » — ils existent tous les
 * trente-quatre, avec leur vocabulaire — mais « des fonctions PROPRES à ce
 * métier sont livrées ».
 */
export const SECTEURS_AVEC_MODULE: readonly Vertical[] = [
  "batiment", "industrie_btp",
];

/** Ce que TOUT tenant reçoit, quel que soit son métier. */
export const FONCTIONS_GENERIQUES: readonly string[] = [
  "Devis et factures conformes, au format Factur-X",
  "Suivi des impayés et relances",
  "Trésorerie, seuil de rentabilité et prévisionnel",
  "Équipe, heures et disponibilités",
  "Classeur des documents",
  "Assistant qui agit à votre place, avec validation",
];

/** Ce qu'un secteur outillé reçoit EN PLUS. Vide pour les autres. */
export const FONCTIONS_SECTORIELLES: Readonly<Partial<Record<Vertical, readonly string[]>>> = {
  batiment: [
    "Autoliquidation de TVA en sous-traitance",
    "Retenue de garantie sur marché",
    "Mention automatique de l'assurance décennale",
    "Signaux publics de chantier (permis de construire, marchés publics)",
  ],
  industrie_btp: [
    "Autoliquidation de TVA en sous-traitance",
    "Retenue de garantie sur marché",
    "Mention automatique de l'assurance décennale",
    "Signaux publics de chantier (permis de construire, marchés publics)",
  ],
};

export function secteurOutille(v: Vertical | null | undefined): boolean {
  return v !== null && v !== undefined && SECTEURS_AVEC_MODULE.includes(v);
}

export interface CouvertureSecteur {
  readonly outille: boolean;
  /** Ce qui marche déjà. Jamais vide — le tronc commun est toujours là. */
  readonly generiques: readonly string[];
  /** Ce que le métier ajoute. Vide quand aucun module n'existe. */
  readonly sectorielles: readonly string[];
  /** La phrase à afficher, déjà rédigée. */
  readonly message: string;
}

/**
 * Ce qu'on doit dire à quelqu'un qui vient de choisir son secteur.
 *
 * ── Ce que ce message ne fait PAS ─────────────────────────────────────────
 * Il ne s'excuse pas et ne minimise pas. « Les spécificités de votre secteur
 * seront ajoutées » est une promesse qu'on ne peut pas tenir sur commande :
 * la formule retenue dit ce qui existe, dit ce qui n'existe pas encore, et
 * ne s'engage sur aucune date.
 */
export function couvertureSecteur(
  v: Vertical | null | undefined,
  libelleSecteur?: string | null,
): CouvertureSecteur {
  const outille = secteurOutille(v);
  const sectorielles = (v && FONCTIONS_SECTORIELLES[v]) ?? [];

  if (outille && sectorielles.length > 0) {
    return {
      outille: true, generiques: FONCTIONS_GENERIQUES, sectorielles,
      message:
        "Votre métier a son module dédié : en plus de la gestion courante, "
        + "nodaq connaît ses obligations propres.",
    };
  }

  const nom = libelleSecteur?.trim();
  return {
    outille: false,
    generiques: FONCTIONS_GENERIQUES,
    sectorielles: [],
    // Le nom du métier est repris quand on l'a : « votre secteur » est une
    // formule d'administration, pas une phrase qu'on adresse à quelqu'un.
    message:
      `Toute la gestion courante fonctionne dès maintenant${nom ? ` pour ${nom}` : ""} : `
      + "devis, factures, impayés, trésorerie, équipe. "
      + "En revanche, nodaq ne connaît pas encore les obligations propres à "
      + "votre métier — celles du bâtiment sont les seules outillées à ce jour. "
      + "Rien n'est bloqué pour autant.",
  };
}

/**
 * Le libellé du choix « mon métier n'est pas dans la liste ».
 *
 * Écrit ici et non à l'écran : le serveur s'en sert aussi, dans la remontée
 * des secteurs demandés. Deux formulations dériveraient.
 */
export const LIBELLE_SECTEUR_AUTRE = "Mon métier n'est pas dans cette liste";

/**
 * Ce qu'on demande ensuite, et pourquoi on le demande.
 *
 * Le critère d'acceptation 3 de la story : « quand plusieurs utilisateurs le
 * signalent, alors cette donnée remonte de façon exploitable côté produit ».
 * Un champ libre stocké et interrogeable, donc — pas un message statique.
 */
export const INVITE_SECTEUR_LIBRE =
  "Quel est votre métier ? Nous nous en servons pour choisir le prochain "
  + "module à construire.";
