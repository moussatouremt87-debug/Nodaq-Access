/**
 * Mandat de négociation de la relance — ticket 4.18, US-9 (et US-1/US-3).
 *
 * C'est le cœur vendeur du produit : l'agent vocal est autonome *à l'intérieur*
 * de limites que le dirigeant a posées à froid, jamais au-delà. Deux étages, et
 * l'ordre compte :
 *
 *   1. la RÈGLE DU TENANT (ici, US-9) fixe le plafond de ce qui est négociable
 *      dans l'entreprise. Elle se décide une fois, dans les paramètres ;
 *   2. le MANDAT DE CAMPAGNE (lot 2, US-1) peut RESTREINDRE ce plafond pour une
 *      campagne donnée — jamais le dépasser.
 *
 * Ce module ne porte que l'étage 1 et le vocabulaire commun. Aucune I/O : la
 * règle est une donnée, sa lecture appartient au serveur.
 *
 * ── Pourquoi des bornes relatives ────────────────────────────────────────
 * `retardMaxJours` compte des jours après l'échéance de la facture, pas une
 * date. Une date absolue serait périmée à la campagne suivante et obligerait le
 * dirigeant à rouvrir l'écran chaque mois ; le mandat de campagne, lui, la
 * résoudra en date ferme au moment de l'approbation.
 */

/** Ce qu'un dirigeant autorise son agent à accorder, dans son entreprise. */
export interface RegleRelance {
  /** Proposer un échelonnement. Faux par défaut — voir `REGLE_RELANCE_DEFAUT`. */
  readonly echelonnementAutorise: boolean;
  /** Nombre maximal de versements, quand l'échelonnement est autorisé. */
  readonly maxVersements: number;
  /** Le premier versement doit tomber sous ce délai, en jours. */
  readonly delaiMaxPremierVersementJours: number;
  /** Retard maximal acceptable, en jours après l'échéance de la facture. */
  readonly retardMaxJours: number;
  /** Envoyer un lien de paiement par SMS pendant l'appel. */
  readonly lienPaiementAutorise: boolean;
  /** Accorder une remise. Faux par défaut, et il faut un geste pour l'ouvrir. */
  readonly remiseAutorisee: boolean;
}

/**
 * Le défaut d'un tenant qui n'a jamais ouvert l'écran.
 *
 * Échelonnement et remise fermés : l'US-9 exige que « l'autonomie de
 * négociation soit un choix explicite, jamais un défaut silencieux ». Un agent
 * sous cette règle obtient une date de règlement, et ne concède rien d'autre —
 * ce qui reste utile, et ne peut engager personne par inadvertance.
 */
export const REGLE_RELANCE_DEFAUT: RegleRelance = {
  echelonnementAutorise: false,
  maxVersements: 3,
  delaiMaxPremierVersementJours: 15,
  retardMaxJours: 30,
  lienPaiementAutorise: false,
  remiseAutorisee: false,
};

/** Bornes dures, alignées sur les CHECK de la migration 041. */
export const BORNES_REGLE_RELANCE = {
  maxVersements: { min: 1, max: 12 },
  delaiMaxPremierVersementJours: { min: 0, max: 90 },
  retardMaxJours: { min: 0, max: 365 },
} as const;

export interface AnomalieRegle {
  readonly champ: keyof RegleRelance;
  readonly message: string;
}

/**
 * Vérifie qu'une règle se tient — bornes respectées, et surtout cohérence
 * interne.
 *
 * Les bornes doublent les CHECK SQL délibérément : la base refuserait la ligne,
 * mais avec une erreur de contrainte que l'utilisateur ne peut pas lire. Ici on
 * peut lui dire ce qui ne va pas, dans sa langue, avant d'écrire.
 */
export function verifierRegleRelance(regle: RegleRelance): AnomalieRegle[] {
  const anomalies: AnomalieRegle[] = [];
  const borne = (
    champ: "maxVersements" | "delaiMaxPremierVersementJours" | "retardMaxJours",
    libelle: string,
  ) => {
    const { min, max } = BORNES_REGLE_RELANCE[champ];
    const valeur = regle[champ];
    if (!Number.isInteger(valeur) || valeur < min || valeur > max) {
      anomalies.push({
        champ,
        message: `${libelle} doit être un nombre entier entre ${min} et ${max}.`,
      });
    }
  };

  borne("maxVersements", "Le nombre de versements");
  borne("delaiMaxPremierVersementJours", "Le délai du premier versement");
  borne("retardMaxJours", "Le retard maximal accepté");

  // Un échelonnement en un seul versement n'est pas un échelonnement : c'est un
  // paiement, et l'agent le proposerait comme une concession alors qu'il n'en
  // accorde aucune. Mieux vaut le refuser à la saisie que laisser un dirigeant
  // croire qu'il a ouvert une marge de manœuvre.
  if (regle.echelonnementAutorise && regle.maxVersements < 2) {
    anomalies.push({
      champ: "maxVersements",
      message:
        "Un échelonnement suppose au moins deux versements. Augmentez le nombre de versements, ou désactivez l'échelonnement.",
    });
  }

  return anomalies;
}

/**
 * Ce que la règle laisse réellement négocier, en une phrase lisible.
 *
 * Rendu ici et pas dans l'écran : la même phrase sert au panneau de validation
 * d'une campagne (US-1) et à l'écran de réglage (US-9), et deux formulations
 * finiraient par décrire deux règles différentes.
 */
export function resumerRegleRelance(regle: RegleRelance): string {
  const concessions: string[] = [];
  if (regle.echelonnementAutorise) {
    concessions.push(
      `un échelonnement jusqu'à ${regle.maxVersements} versements (premier sous ${regle.delaiMaxPremierVersementJours} jours)`,
    );
  }
  if (regle.lienPaiementAutorise) concessions.push("un lien de paiement");
  if (regle.remiseAutorisee) concessions.push("une remise");

  const base = `L'agent peut accepter un règlement jusqu'à ${regle.retardMaxJours} jours après l'échéance`;
  if (concessions.length === 0) {
    return `${base}. Il n'accorde rien d'autre : ni échelonnement, ni lien de paiement, ni remise.`;
  }
  return `${base}, et proposer ${concessions.join(", ")}.`;
}

// ── Étage 2 : le mandat de campagne (US-1) ─────────────────────────────────

/**
 * Ce que l'agent peut accorder POUR UNE CAMPAGNE donnée.
 *
 * Même forme que la règle du tenant, et ce n'est pas une commodité : c'est ce
 * qui rend la comparaison possible champ à champ, donc l'invariant vérifiable.
 */
export type MandatCampagne = RegleRelance;

/** Une demande de restriction. Tout champ absent = « on garde la règle ». */
export type DemandeMandat = Partial<RegleRelance>;

export interface DepassementMandat {
  readonly champ: keyof RegleRelance;
  readonly message: string;
}

/**
 * L'INVARIANT CENTRAL du ticket : une campagne RESTREINT la règle du tenant,
 * jamais elle ne l'élargit (US-1, US-3).
 *
 * C'est le mécanisme qui rend l'autonomie de l'agent acceptable. Le dirigeant a
 * posé un plafond à froid (US-9) ; au moment de valider une campagne il peut
 * serrer davantage — désactiver l'échelonnement pour un débiteur récidiviste,
 * par exemple — mais aucun chemin ne doit lui permettre de desserrer sans
 * repasser par l'écran de règle, à froid.
 *
 * Rendu par CLAMPING plutôt que par refus : une demande trop large est ramenée
 * à la règle au lieu d'être rejetée. Deux raisons. D'abord un formulaire
 * pré-rempli depuis la règle renverra naturellement des valeurs égales à la
 * règle — les refuser transformerait le cas nominal en erreur. Ensuite le
 * clamping est SÛR par construction : quoi qu'on lui passe, y compris un corps
 * forgé, il ne peut pas rendre un mandat plus large que la règle.
 *
 * `depassementsMandat` sert à DIRE ce qui a été ramené, pour que l'écran ne
 * fasse pas silencieusement autre chose que ce qui a été demandé.
 */
export function restreindreMandat(
  regle: RegleRelance,
  demande: DemandeMandat = {},
): MandatCampagne {
  // Un booléen ne peut passer de `false` (règle) à `true` (demande) : l'ET
  // logique porte l'invariant à lui seul.
  const et = (cleRegle: boolean, cleDemande: boolean | undefined): boolean =>
    cleRegle && (cleDemande ?? true);

  // Un nombre ne peut que DIMINUER — il borne ce que l'agent peut concéder.
  const plusPetit = (valeurRegle: number, valeurDemande: number | undefined): number =>
    valeurDemande === undefined || !Number.isFinite(valeurDemande)
      ? valeurRegle
      : Math.max(0, Math.min(valeurRegle, Math.trunc(valeurDemande)));

  return {
    echelonnementAutorise: et(regle.echelonnementAutorise, demande.echelonnementAutorise),
    maxVersements: plusPetit(regle.maxVersements, demande.maxVersements),
    delaiMaxPremierVersementJours: plusPetit(
      regle.delaiMaxPremierVersementJours,
      demande.delaiMaxPremierVersementJours,
    ),
    retardMaxJours: plusPetit(regle.retardMaxJours, demande.retardMaxJours),
    lienPaiementAutorise: et(regle.lienPaiementAutorise, demande.lienPaiementAutorise),
    remiseAutorisee: et(regle.remiseAutorisee, demande.remiseAutorisee),
  };
}

/**
 * Ce qu'une demande tentait d'élargir au-delà de la règle.
 *
 * Vide dans le cas nominal. Non vide, c'est soit une interface qui propose plus
 * que la règle — un défaut à corriger —, soit un corps forgé. Dans les deux cas
 * `restreindreMandat` a déjà protégé le résultat ; ceci sert à le dire.
 */
export function depassementsMandat(
  regle: RegleRelance,
  demande: DemandeMandat,
): DepassementMandat[] {
  const depassements: DepassementMandat[] = [];

  const drapeau = (champ: "echelonnementAutorise" | "lienPaiementAutorise" | "remiseAutorisee", libelle: string) => {
    if (demande[champ] === true && !regle[champ]) {
      depassements.push({
        champ,
        message: `${libelle} n'est pas autorisé par la règle de l'entreprise. Modifiez la règle dans les paramètres pour l'ouvrir.`,
      });
    }
  };

  const borne = (
    champ: "maxVersements" | "delaiMaxPremierVersementJours" | "retardMaxJours",
    libelle: string,
  ) => {
    const valeur = demande[champ];
    if (valeur !== undefined && Number.isFinite(valeur) && valeur > regle[champ]) {
      depassements.push({
        champ,
        message: `${libelle} ne peut pas dépasser ${regle[champ]}, fixé par la règle de l'entreprise.`,
      });
    }
  };

  drapeau("echelonnementAutorise", "L'échelonnement");
  drapeau("lienPaiementAutorise", "Le lien de paiement");
  drapeau("remiseAutorisee", "La remise");
  borne("maxVersements", "Le nombre de versements");
  borne("delaiMaxPremierVersementJours", "Le délai du premier versement");
  borne("retardMaxJours", "Le retard accepté");

  return depassements;
}

/** Vrai si le mandat est strictement plus serré que la règle, sur au moins un point. */
export function mandatEstRestreint(regle: RegleRelance, mandat: MandatCampagne): boolean {
  return (
    regle.echelonnementAutorise !== mandat.echelonnementAutorise ||
    regle.lienPaiementAutorise !== mandat.lienPaiementAutorise ||
    regle.remiseAutorisee !== mandat.remiseAutorisee ||
    regle.maxVersements !== mandat.maxVersements ||
    regle.delaiMaxPremierVersementJours !== mandat.delaiMaxPremierVersementJours ||
    regle.retardMaxJours !== mandat.retardMaxJours
  );
}
