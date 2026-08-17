/*
 * Objectifs du cockpit — calcul DÉTERMINISTE.
 *
 * Zéro appel modèle, zéro accès base, zéro réseau : des nombres entrent, des
 * nombres sortent. C'est ce qui permet de les éprouver contre des cas posés à
 * la main, et la seule façon d'oser afficher au patron d'une TPE un chiffre
 * censé être le sien.
 *
 * LA RÈGLE QUI COMMANDE LE RESTE : un objectif faux est pire qu'un objectif
 * absent. Un seuil de rentabilité inventé fait embaucher ; un seuil à zéro
 * s'affiche comme un objectif atteint. Quand une donnée manque, ce module rend
 * `null` et l'appelant se tait — il n'estime jamais.
 */

import { toDateString } from "./dates.js";

// ── Bornes d'exercice ────────────────────────────────────────────────────────

/**
 * Premier jour de l'exercice civil, en date métier.
 *
 * Construit à partir des composantes LOCALES : une borne dérivée d'un
 * toISOString rangerait le 1er janvier dans l'exercice précédent près de
 * minuit, et l'écart annoncé au patron porterait sur la mauvaise année.
 */
export function debutExercice(aujourdhui: Date = new Date()): string {
  return toDateString(new Date(aujourdhui.getFullYear(), 0, 1));
}

/** Premier jour de l'exercice précédent. */
export function debutExercicePrecedent(aujourdhui: Date = new Date()): string {
  return toDateString(new Date(aujourdhui.getFullYear() - 1, 0, 1));
}

/**
 * Même jour, un an plus tôt — borne de la comparaison « à date ».
 *
 * Le recollage de composantes (`${annee-1}-${mois}-${jour}`) produit une date
 * INEXISTANTE un 29 février quand le millésime précédent n'est pas bissextile :
 * « 2027-02-29 » fait échouer la requête. `new Date(2027, 1, 29)` ne vaut pas
 * mieux, il déborde silencieusement au 1er mars et compte un jour de trop.
 *
 * On ramène donc explicitement au dernier jour du mois visé.
 */
export function memeJourExercicePrecedent(aujourdhui: Date = new Date()): string {
  const annee = aujourdhui.getFullYear() - 1;
  const mois = aujourdhui.getMonth();
  const dernierJourDuMois = new Date(annee, mois + 1, 0).getDate();
  const jour = Math.min(aujourdhui.getDate(), dernierJourDuMois);
  return toDateString(new Date(annee, mois, jour));
}

// ── Médiane ──────────────────────────────────────────────────────────────────

/**
 * Médiane d'une série. `null` si la série est vide.
 *
 * Médiane et non moyenne : un seul chantier exceptionnel — la réfection d'une
 * toiture d'immeuble au milieu de dépannages — tire la moyenne au point de
 * rendre la conversion « il vous faut N chantiers » absurde. La médiane décrit
 * le chantier ORDINAIRE de l'entreprise, qui est ce qu'on cherche.
 */
export function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 === 1
    ? triees[milieu]!
    : (triees[milieu - 1]! + triees[milieu]!) / 2;
}

// ── Seuil de rentabilité ─────────────────────────────────────────────────────

/** Ce que l'utilisateur a explicitement renseigné. Rien n'est déduit. */
export interface SaisieRentabilite {
  /** Charges fixes annuelles en centimes. `null` = non renseigné. */
  readonly chargesFixesAnnuellesCents: number | null;
  /** Taux de marge sur coûts variables, en points de base (3500 = 35 %). */
  readonly tauxMargeBps: number | null;
}

export interface SeuilRentabilite {
  readonly seuilCents: number;
  /** D'où vient la valeur — affiché, jamais masqué. */
  readonly provenance: "saisie";
}

/**
 * Seuil = charges fixes ÷ taux de marge sur coûts variables.
 *
 * Rend `null` — et JAMAIS zéro — dès qu'une des deux données manque ou n'est
 * pas exploitable. Un seuil à zéro s'afficherait comme un objectif déjà
 * atteint, ce qui est le contraire de la vérité pour une entreprise qui n'a
 * rien renseigné.
 *
 * Aucune dérivation depuis la comptabilité : `cr_entries` porte des postes du
 * plan comptable sans distinction fixe/variable, et « Autres achats (61-62) »
 * agrège le loyer, qui est fixe, avec la sous-traitance, qui est variable. Les
 * classer d'office serait inventer un ratio que l'utilisateur n'a pas fourni.
 */
export function calculerSeuilRentabilite(saisie: SaisieRentabilite): SeuilRentabilite | null {
  const { chargesFixesAnnuellesCents: charges, tauxMargeBps: taux } = saisie;
  if (charges === null || taux === null) return null;
  if (!Number.isFinite(charges) || charges <= 0) return null;
  if (!Number.isFinite(taux) || taux <= 0 || taux > 10_000) return null;

  const seuilCents = Math.round(charges / (taux / 10_000));
  // Un seuil non strictement positif n'est pas un objectif : on se tait.
  return seuilCents > 0 ? { seuilCents, provenance: "saisie" } : null;
}

// ── Marge pondérée par catégorie (US-A3.3) ──────────────────────────────────

/**
 * Une catégorie de produits/prestations déclarée par l'utilisateur — pas une
 * ligne de vente réelle. Le catalogue et les lignes de facture/devis ne
 * portent aucun coût ni lien entre eux ; calculer une marge pondérée à partir
 * de vraies données de vente demanderait ce chantier de données, hors
 * périmètre ici. Ceci reste une SAISIE, comme `SaisieRentabilite`.
 */
export interface CategorieMarge {
  /** Points de base (3500 = 35 %). */
  readonly tauxMargeBps: number;
  /** Part du CA en points de base — n'a pas besoin de sommer à 10 000 entre
   *  catégories : la moyenne se normalise par la somme réelle des parts. */
  readonly partCaBps: number;
}

/**
 * Moyenne du taux de marge, pondérée par la part de CA de chaque catégorie.
 *
 * `null` — jamais 0 — si la liste est vide ou si la somme des parts est
 * nulle : un taux à zéro ferait diverger par zéro dans `calculerSeuilRentabilite`
 * ou produirait un seuil infini, deux façons de mentir à l'utilisateur.
 */
export function tauxMargePondere(categories: readonly CategorieMarge[]): number | null {
  if (categories.length === 0) return null;
  const sommeParts = categories.reduce((s, c) => s + c.partCaBps, 0);
  if (sommeParts <= 0) return null;
  const sommePonderee = categories.reduce((s, c) => s + c.tauxMargeBps * c.partCaBps, 0);
  return Math.round(sommePonderee / sommeParts);
}

// ── Conversion d'un écart en chantiers ───────────────────────────────────────

/** Une affaire terminée, réduite à ce que la conversion lit. */
export interface AffaireTerminee {
  readonly montantCents: number;
  readonly dureeJours: number;
}

/** Nombre minimal d'affaires terminées pour oser une conversion. */
export const MIN_AFFAIRES_POUR_CONVERSION = 5;

export interface ConversionChantiers {
  readonly nbChantiers: number;
  readonly montantMedianCents: number;
  readonly dureeMedianeJours: number;
  readonly nbAffairesObservees: number;
}

/**
 * Traduit un écart en euros en nombre de chantiers ordinaires.
 *
 * Rend `null` sous MIN_AFFAIRES_POUR_CONVERSION : en deçà, la médiane décrit
 * une poignée de cas particuliers et non l'activité de l'entreprise. L'écart en
 * euros seul reste affichable, et il suffit.
 */
export function convertirEnChantiers(
  ecartCents: number,
  affaires: readonly AffaireTerminee[],
): ConversionChantiers | null {
  if (affaires.length < MIN_AFFAIRES_POUR_CONVERSION) return null;
  if (ecartCents <= 0) return null;

  const montantMedianCents = mediane(affaires.map((a) => a.montantCents));
  const dureeMedianeJours = mediane(affaires.map((a) => a.dureeJours));
  if (montantMedianCents === null || montantMedianCents <= 0) return null;
  if (dureeMedianeJours === null) return null;

  return {
    nbChantiers: Math.ceil(ecartCents / montantMedianCents),
    montantMedianCents,
    dureeMedianeJours,
    nbAffairesObservees: affaires.length,
  };
}

// ── Registre du texte ────────────────────────────────────────────────────────

/**
 * Le ton est décidé ICI, côté serveur, et transmis au front comme un champ.
 * Le déduire dans le navigateur ferait diverger deux écrans sur le même écart.
 */
export type TonObjectif = "atteint" | "a_portee" | "loin";

/**
 * Choisit le registre.
 *
 * « à portée » signifie : l'écart restant est inférieur à ce que les chantiers
 * ordinaires de l'entreprise peuvent raisonnablement produire d'ici la fin de
 * l'exercice. Sans conversion possible (moins de cinq affaires), on ne peut pas
 * l'affirmer — et on ne le suppose pas : c'est « loin ».
 *
 * « loin » ne reçoit AUCUN encouragement et AUCUN emoji. Un artisan qui n'y est
 * pas n'a pas besoin qu'on l'applaudisse ; il a besoin d'un constat et d'une
 * action.
 */
export function choisirTon(
  ecartCents: number,
  conversion: ConversionChantiers | null,
  joursRestants: number,
): TonObjectif {
  if (ecartCents <= 0) return "atteint";
  if (conversion === null) return "loin";

  // Combien de chantiers ordinaires tiennent encore dans l'exercice ?
  const dureeUtile = Math.max(conversion.dureeMedianeJours, 1);
  const chantiersPossibles = Math.floor(joursRestants / dureeUtile);
  return conversion.nbChantiers <= chantiersPossibles ? "a_portee" : "loin";
}

/** Jours restants dans l'exercice civil, à partir des composantes locales. */
export function joursRestantsExercice(aujourdhui: Date = new Date()): number {
  const finExercice = new Date(aujourdhui.getFullYear(), 11, 31);
  const jour = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());
  return Math.max(0, Math.round((finExercice.getTime() - jour.getTime()) / 86_400_000));
}
