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
