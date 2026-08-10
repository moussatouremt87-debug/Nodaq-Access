/*
 * Coût de la main-d'œuvre — LA convention unique du produit.
 *
 * Il existe deux façons de renseigner ce que coûte une journée de travail :
 * le réglage d'équipe `equipe.coutJourCharge` (un coût jour, en euros), et
 * `team_members.cout_mensuel_charge` (un coût MENSUEL, en euros, par membre).
 * Sans une conversion unique et documentée, chaque écran inventerait la sienne
 * et deux pages afficheraient deux marges différentes pour le même chantier.
 *
 * Règle de résolution, dans cet ordre :
 *   1. le coût mensuel du membre, s'il est renseigné — c'est le plus précis ;
 *   2. à défaut, le coût jour d'équipe — une moyenne, mais une vraie donnée ;
 *   3. à défaut, INCONNU (`null`).
 *
 * Le troisième cas n'est JAMAIS traité comme zéro. Des heures dont le coût est
 * inconnu ne peuvent que diminuer la marge : elles font basculer le calcul en
 * borne supérieure (voir affaireMargin.ts). Compter zéro produirait une marge
 * flatteuse et fausse — exactement ce que le module de marge refuse.
 *
 * Toutes les entrées sont en EUROS (la forme sous laquelle elles sont saisies
 * et stockées) ; toutes les sorties sont en CENTIMES, l'unité de calcul.
 */

/**
 * Heures d'une journée de travail standard.
 *
 * 7 h : la durée légale française est de 35 h hebdomadaires sur 5 jours. Sert
 * à passer d'un coût JOUR à un coût HORAIRE, les pointages étant saisis en
 * heures alors que les coûts sont renseignés à la journée ou au mois.
 */
export const HEURES_PAR_JOUR_STANDARD = 7;

/**
 * Semaines par mois, en moyenne annuelle : 52 / 12 ≈ 4,333.
 *
 * Utiliser 4 sous-estimerait le nombre de jours travaillés d'environ 8 %, donc
 * surestimerait le coût jour d'autant — et gonflerait les coûts imputés à
 * chaque chantier.
 */
export const SEMAINES_PAR_MOIS = 52 / 12;

/**
 * Coût jour chargé déduit d'un coût mensuel chargé.
 *
 * Rend `null` si l'une des deux données manque ou n'est pas exploitable : un
 * coût jour inventé vaut moins qu'un coût jour absent.
 */
export function coutJourDepuisMensuel(
  coutMensuelChargeEuros: number | null | undefined,
  joursParSemaine: number | null | undefined,
): number | null {
  if (coutMensuelChargeEuros === null || coutMensuelChargeEuros === undefined) return null;
  if (joursParSemaine === null || joursParSemaine === undefined) return null;
  if (!Number.isFinite(coutMensuelChargeEuros) || coutMensuelChargeEuros <= 0) return null;
  if (!Number.isFinite(joursParSemaine) || joursParSemaine <= 0) return null;

  const joursParMois = joursParSemaine * SEMAINES_PAR_MOIS;
  return coutMensuelChargeEuros / joursParMois;
}

/** Données de coût d'un membre, telles qu'elles sortent de la base. */
export interface CoutMembreInput {
  /** `team_members.cout_mensuel_charge`, en euros. `null` = non renseigné. */
  readonly coutMensuelChargeEuros: number | null | undefined;
  /** `team_members.jours_par_semaine`. */
  readonly joursParSemaine: number | null | undefined;
  /** Réglage `equipe.coutJourCharge`, en euros. `null` = non renseigné. */
  readonly coutJourChargeEquipeEuros: number | null | undefined;
}

/**
 * Coût HORAIRE chargé d'un membre, en CENTIMES, ou `null` si inconnu.
 *
 * `null` est un résultat légitime et attendu : il signifie « on ne sait pas »,
 * et l'appelant doit le propager jusqu'à l'affichage. Ne jamais le remplacer
 * par 0 ni par une valeur par défaut.
 */
export function resoudreCoutHoraireMembreCents(input: CoutMembreInput): number | null {
  const coutJourEuros =
    coutJourDepuisMensuel(input.coutMensuelChargeEuros, input.joursParSemaine) ??
    (typeof input.coutJourChargeEquipeEuros === "number" &&
    Number.isFinite(input.coutJourChargeEquipeEuros) &&
    input.coutJourChargeEquipeEuros > 0
      ? input.coutJourChargeEquipeEuros
      : null);

  if (coutJourEuros === null) return null;

  return Math.round((coutJourEuros / HEURES_PAR_JOUR_STANDARD) * 100);
}
