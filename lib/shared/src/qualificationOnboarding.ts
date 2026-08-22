/*
 * Qualification à l'inscription — ticket 4.36, lot A.
 *
 * ── Ce qui distingue ce questionnaire d'un questionnaire ──────────────────
 * « Un onboarding qui ne configure rien est un questionnaire marketing, pas un
 * onboarding. » Chaque réponse d'ici a un effet : le stade d'immatriculation
 * décide de ce que le compte a le droit d'ÉMETTRE, le métier active le bloc
 * déchets et les gabarits, l'irritant oriente la première action proposée.
 *
 * Les réponses qui ne servent qu'à comprendre le marché — comment l'entreprise
 * gère aujourd'hui, quel logiciel elle quitte — sont assumées comme telles et
 * marquées ci-dessous. Les mélanger sans le dire serait malhonnête envers
 * l'utilisateur qui répond.
 *
 * ── Chaque écran est PASSABLE ─────────────────────────────────────────────
 * Aucune réponse n'est obligatoire. Un onboarding bloquant est un onboarding
 * qu'on abandonne, et un compte à moitié configuré vaut mieux qu'un compte
 * jamais créé.
 */

/**
 * Où en est l'entreprise.
 *
 * ── Les trois répondent OUI à l'inscription ───────────────────────────────
 * Un fondateur en cours d'immatriculation doit pouvoir tout préparer : devis
 * en brouillon, réglages, catalogue. Le refuser reviendrait à exiger un SIREN
 * pour essayer un logiciel — c'est-à-dire à perdre exactement les gens qui en
 * ont le plus besoin, au moment où ils choisissent leurs outils.
 *
 * Ce qui se débloque avec le SIREN, ce n'est pas l'accès : c'est l'ÉMISSION de
 * documents légaux, qui exige un numéro sur la facture (art. 242 nonies A CGI).
 */
export const STADES_ENTREPRISE = ["EXISTANTE", "EN_IMMATRICULATION", "EN_PROJET"] as const;
export type StadeEntreprise = (typeof STADES_ENTREPRISE)[number];

export const LIBELLE_STADE: Readonly<Record<StadeEntreprise, string>> = {
  EXISTANTE: "Mon entreprise existe déjà",
  EN_IMMATRICULATION: "Elle est en cours d'immatriculation",
  EN_PROJET: "C'est encore un projet",
};

export const EFFECTIFS = ["SEUL", "DE_2_A_3", "DE_4_A_6", "DE_7_A_10", "PLUS_DE_10"] as const;
export type Effectif = (typeof EFFECTIFS)[number];

export const LIBELLE_EFFECTIF: Readonly<Record<Effectif, string>> = {
  SEUL: "Je travaille seul",
  DE_2_A_3: "2 à 3 personnes",
  DE_4_A_6: "4 à 6 personnes",
  DE_7_A_10: "7 à 10 personnes",
  PLUS_DE_10: "Plus de 10",
};

/** Réponse de VEILLE : elle n'active rien, elle nous apprend le marché. */
export const GESTIONS_ACTUELLES = ["JAMAIS_FAIT", "PAPIER_TABLEUR", "AUTRE_LOGICIEL"] as const;
export type GestionActuelle = (typeof GESTIONS_ACTUELLES)[number];

export const LIBELLE_GESTION: Readonly<Record<GestionActuelle, string>> = {
  JAMAIS_FAIT: "Je n'ai jamais fait de devis ni de factures",
  PAPIER_TABLEUR: "Papier, Word ou Excel",
  AUTRE_LOGICIEL: "Un autre logiciel",
};

/**
 * L'irritant principal. Il PILOTE la première action proposée — c'est la seule
 * réponse dont l'effet est immédiatement visible par celui qui la donne.
 */
export const IRRITANTS = ["IMPAYES", "PAPERASSE", "TRESORERIE", "RELANCES", "AUTRE"] as const;
export type Irritant = (typeof IRRITANTS)[number];

export const LIBELLE_IRRITANT: Readonly<Record<Irritant, string>> = {
  IMPAYES: "Les clients qui ne paient pas",
  PAPERASSE: "La paperasse du soir",
  TRESORERIE: "Ne pas savoir où j'en suis",
  RELANCES: "Devoir relancer sans arrêt",
  AUTRE: "Autre chose",
};

export interface ProfilQualification {
  readonly stade: StadeEntreprise | null;
  readonly effectif: Effectif | null;
  readonly gestionActuelle: GestionActuelle | null;
  /** Nom du logiciel quitté, quand il y en a un. Veille concurrentielle. */
  readonly logicielActuel: string | null;
  readonly irritant: Irritant | null;
  /** Le verbatim de l'irritant « autre » — boucle produit. */
  readonly irritantVerbatim: string | null;
  readonly termineeLe: string | null;
}

export const PROFIL_VIDE: ProfilQualification = {
  stade: null,
  effectif: null,
  gestionActuelle: null,
  logicielActuel: null,
  irritant: null,
  irritantVerbatim: null,
  termineeLe: null,
};

/**
 * Le compte peut-il émettre un document légal ?
 *
 * ── Ce que cette fonction ne fait PAS ─────────────────────────────────────
 * Elle ne remplace pas la garde d'émission. `REGLES_MENTIONS` refuse déjà
 * l'émission sans SIRET, de façon bloquante, et c'est elle qui fait foi — une
 * seconde vérification côté écran serait une seconde vérité à maintenir.
 *
 * Elle sert à EXPLIQUER : dire « il vous manque votre numéro SIREN » avant que
 * l'utilisateur tente d'émettre, plutôt que de le laisser buter sur un refus
 * technique après avoir rempli un devis entier.
 */
export function peutEmettreDocumentLegal(
  profil: Pick<ProfilQualification, "stade">,
  siretRenseigne: boolean,
): boolean {
  if (siretRenseigne) return true;
  // Sans SIRET, aucun stade ne permet d'émettre — pas même « existante ». Le
  // stade ne change pas la loi, il change seulement ce qu'on EXPLIQUE.
  return false;
}

/** Ce qu'on dit à quelqu'un qui ne peut pas encore émettre. */
export function messageSirenManquant(stade: StadeEntreprise | null): string {
  if (stade === "EN_IMMATRICULATION") {
    return (
      "Vous pouvez tout préparer — devis, catalogue, réglages. Dès que vous " +
      "recevrez votre numéro SIREN, saisissez-le et l'émission de vos devis et " +
      "factures se débloquera."
    );
  }
  if (stade === "EN_PROJET") {
    return (
      "Vous pouvez tout préparer en attendant de créer votre entreprise. " +
      "L'émission de documents légaux demandera votre numéro SIREN."
    );
  }
  return (
    "Il manque le numéro SIRET de votre entreprise pour émettre des devis et " +
    "des factures — c'est une mention obligatoire. Il se saisit dans Profil " +
    "entreprise."
  );
}

export interface PremiereAction {
  readonly cle: string;
  readonly titre: string;
  readonly chemin: string;
}

/**
 * La première action guidée, choisie d'après l'irritant.
 *
 * « L'onboarding se termine par UNE action concrète, pas par un cockpit
 * vide. » Un tableau de bord sans données ne montre rien et n'apprend rien :
 * c'est le pire écran d'accueil possible pour quelqu'un qui vient de
 * s'inscrire.
 */
export function premiereAction(profil: ProfilQualification): PremiereAction {
  switch (profil.irritant) {
    case "IMPAYES":
    case "RELANCES":
      return {
        cle: "relancer",
        titre: "Enregistrez une facture impayée — on s'occupe de la relance",
        chemin: "/factures",
      };
    case "TRESORERIE":
      return {
        cle: "reprise",
        titre: "Reprenez vos chantiers en cours pour voir où vous en êtes",
        chemin: "/reprise",
      };
    case "PAPERASSE":
    default:
      // Le défaut est le devis dicté : c'est la promesse centrale du produit,
      // et la démonstration la plus courte de ce qu'il sait faire.
      return {
        cle: "devis_dicte",
        titre: "Dictez votre premier devis — trente secondes",
        chemin: "/chat",
      };
  }
}
