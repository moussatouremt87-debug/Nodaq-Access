/*
 * Mentions de gestion des déchets sur un devis de travaux — ticket 4.35.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 * Décret n° 2020-1817 pris pour l'application de la loi AGEC : les devis de
 * travaux de construction, rénovation, démolition et de jardinage doivent
 * porter quatre mentions relatives aux déchets. Un devis qui ne les porte pas
 * est non conforme, et l'amende encourue se compte en milliers d'euros.
 *
 * Ce n'est donc pas une fonctionnalité, c'est une obligation — et surtout :
 * chaque devis produit sans ce bloc est un devis que NOTRE produit a rendu non
 * conforme.
 *
 * ── Ce que ce module fait ─────────────────────────────────────────────────
 * Il décrit le bloc, dit s'il est requis, et rend le texte à imprimer. Il ne
 * lit aucune base, n'invente aucun chiffre, et ne devine jamais un point de
 * collecte : une donnée non paramétrée s'affiche « à préciser », parce
 * qu'inventer une adresse d'installation sur un document contractuel serait
 * pire que de la laisser vide.
 */

import { VERTICALS, type Vertical } from "./verticalPacks.js";
import { decennaleApplicable } from "./regulatoryWatch.js";

/**
 * Les secteurs auxquels l'obligation s'applique.
 *
 * DÉRIVÉS de `decennaleApplicable`, comme `VERTICALS_TRAVAUX` dans
 * `mentions-obligatoires.ts` : ce sont les mêmes « métiers du bâti », et deux
 * listes recopiées finiraient par diverger. Le décret vise la construction, la
 * rénovation, la démolition et le jardinage — soit exactement le périmètre où
 * la garantie décennale a un sens, augmenté du paysage qui y figure déjà.
 */
export const VERTICALS_DECHETS: readonly Vertical[] = VERTICALS.filter(decennaleApplicable);

/** L'obligation s'applique-t-elle à ce secteur ? */
export function dechetsObligatoires(vertical: string | null | undefined): boolean {
  if (!vertical) return false;
  return (VERTICALS_DECHETS as readonly string[]).includes(vertical);
}

/**
 * Les natures de déchets, telles que le décret les distingue.
 *
 * Trois catégories et pas davantage : c'est la classification réglementaire,
 * pas une taxonomie qu'on enrichit au goût.
 */
export const NATURES_DECHETS = ["INERTES", "NON_DANGEREUX", "DANGEREUX"] as const;
export type NatureDechet = (typeof NATURES_DECHETS)[number];

export const LIBELLE_NATURE: Readonly<Record<NatureDechet, string>> = {
  INERTES: "inertes (gravats, béton, tuiles)",
  NON_DANGEREUX: "non dangereux (bois, plâtre, métaux, emballages)",
  DANGEREUX: "dangereux (amiante, peintures, solvants)",
};

/** Le bloc porté par un devis. */
export interface GestionDechets {
  /** L'estimation en tonnes. `null` = non estimée, affichée « à préciser ». */
  readonly quantiteTonnes: number | null;
  readonly natures: readonly NatureDechet[];
  /** Tri sur chantier, broyage, évacuation… Texte libre. */
  readonly modalites: string | null;
  readonly pointCollecteNom: string | null;
  readonly pointCollecteAdresse: string | null;
  /** Coût estimé de la gestion, en centimes. `null` = non estimé. */
  readonly coutCents: number | null;
  /**
   * Travaux ne générant aucun déchet.
   *
   * Une case, pas une absence : le décret veut une mention, et un bloc
   * simplement omis ne se distingue pas d'un oubli. Cocher est une décision
   * TRACÉE, ne rien mettre est un défaut.
   */
  readonly sansDechet: boolean;
}

export const DECHETS_VIDE: GestionDechets = {
  quantiteTonnes: null,
  natures: [],
  modalites: null,
  pointCollecteNom: null,
  pointCollecteAdresse: null,
  coutCents: null,
  sansDechet: false,
};

/** Les réglages du tenant, qui préremplissent chaque nouveau devis. */
export interface ReglagesDechets {
  readonly pointCollecteNom: string | null;
  readonly pointCollecteAdresse: string | null;
  readonly coutForfaitaireCents: number | null;
}

/**
 * Le bloc prérempli d'un nouveau devis, à partir des réglages du tenant.
 *
 * Rien n'est inventé : ce qui n'est pas paramétré reste `null`, et se lira
 * « à préciser » sur le document.
 */
export function preremplir(reglages: ReglagesDechets): GestionDechets {
  return {
    ...DECHETS_VIDE,
    pointCollecteNom: reglages.pointCollecteNom,
    pointCollecteAdresse: reglages.pointCollecteAdresse,
    coutCents: reglages.coutForfaitaireCents,
  };
}

/** Ce qui manque encore pour que le bloc soit complet au sens du décret. */
export function mentionsManquantes(d: GestionDechets): readonly string[] {
  // Une déclaration « sans déchet » se suffit à elle-même : il n'y a ni
  // quantité, ni point de collecte, ni coût à annoncer.
  if (d.sansDechet) return [];
  const manque: string[] = [];
  if (d.quantiteTonnes === null) manque.push("quantité estimée");
  if (d.natures.length === 0) manque.push("nature des déchets");
  if (!d.modalites?.trim()) manque.push("modalités d'enlèvement");
  if (!d.pointCollecteNom?.trim()) manque.push("point de collecte");
  if (d.coutCents === null) manque.push("coût estimé");
  return manque;
}

/**
 * Le texte imprimé sur le devis.
 *
 * Rendu ici plutôt que dans le générateur PDF : c'est le même texte qui doit
 * pouvoir s'afficher à l'écran avant validation, et deux rédactions du même
 * bloc finiraient par différer — celle qu'on relit ne serait plus celle qu'on
 * imprime.
 */
export function texteBlocDechets(d: GestionDechets): readonly string[] {
  if (d.sansDechet) {
    return ["Ces travaux ne génèrent pas de déchets de chantier."];
  }
  const aPreciser = "à préciser";
  const lignes: string[] = [
    `Quantité estimée de déchets : ${d.quantiteTonnes !== null ? `${d.quantiteTonnes} tonne(s)` : aPreciser}.`,
    `Nature : ${
      d.natures.length > 0
        ? d.natures.map((n) => LIBELLE_NATURE[n]).join(" ; ")
        : aPreciser
    }.`,
    `Modalités d'enlèvement : ${d.modalites?.trim() || aPreciser}.`,
  ];

  const point = [d.pointCollecteNom?.trim(), d.pointCollecteAdresse?.trim()]
    .filter((v): v is string => !!v)
    .join(" — ");
  lignes.push(`Point de collecte prévu : ${point || aPreciser}.`);
  lignes.push(
    `Coût estimé de la gestion des déchets : ${
      d.coutCents !== null ? `${(d.coutCents / 100).toFixed(2)} €` : aPreciser
    }.`,
  );
  return lignes;
}
