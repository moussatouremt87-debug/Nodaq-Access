/*
 * Où en est ce tenant face à la facturation électronique — ticket 4.36, lot B.
 *
 * ── Les deux échéances, et pourquoi on les sépare ─────────────────────────
 * Elles sont souvent confondues, y compris dans la presse professionnelle :
 *
 *   1er septembre 2026 — toute entreprise assujettie à la TVA doit pouvoir
 *   RECEVOIR une facture électronique. Recevoir, pas émettre. Ça concerne
 *   l'artisan de trois personnes exactement comme le grand groupe.
 *
 *   1er septembre 2027 — les PME, TPE et micro-entreprises doivent ÉMETTRE.
 *
 * Les mélanger ferait paniquer un artisan un an trop tôt, ou le rassurerait à
 * tort. Chaque état de ce module ne parle donc que d'UNE échéance à la fois.
 *
 * ── Le ton ────────────────────────────────────────────────────────────────
 * « On s'en occupe avec vous », jamais « vous risquez une amende ». Le ticket
 * l'écrit : la bannière ne doit jamais être anxiogène. Un artisan qui reçoit
 * une menace de son logiciel de gestion ferme le logiciel.
 *
 * ── Aucune horloge lue ici ────────────────────────────────────────────────
 * `aujourdhui` est un paramètre, comme partout où ce dépôt calcule sur des
 * dates. C'est ce qui rend les bascules d'échéance éprouvables sans faux temps.
 */

/** `YYYY-MM-DD`. Sources : loi de finances 2024 et son calendrier révisé. */
export const ECHEANCE_RECEPTION = "2026-09-01";
export const ECHEANCE_EMISSION_PETITES_ENTREPRISES = "2027-09-01";

/**
 * Fenêtre pendant laquelle une bannière fermée revient d'elle-même.
 *
 * 60 jours : assez tôt pour agir sans être harcelé toute l'année. Une bannière
 * qui revient tous les jours se ferme par réflexe et ne dit plus rien.
 */
export const JOURS_AVANT_RAPPEL = 60;

export type EtatConformite =
  /** Raccordé et confirmé : il n'y a plus rien à faire. */
  | "PRET"
  /** L'échéance de réception approche ou est passée, et rien n'est raccordé. */
  | "RECEPTION_A_FAIRE"
  /** Réception assurée ; l'émission arrive, sans urgence. */
  | "EMISSION_A_VENIR"
  /** Inscrit sur la liste d'attente : on a promis de le guider. */
  | "EN_ATTENTE";

export interface SituationTenant {
  /** Le raccordement est CONFIRMÉ par la plateforme, pas seulement configuré. */
  readonly raccordementConfirme: boolean;
  /** Date d'inscription sur la liste d'attente, `YYYY-MM-DD` ou `null`. */
  readonly inscritListeAttenteLe: string | null;
}

export interface MessageConformite {
  readonly etat: EtatConformite;
  readonly titre: string;
  readonly corps: string;
  /** Libellé du bouton d'action, ou `null` quand il n'y a rien à faire. */
  readonly action: string | null;
  /** Vrai quand l'échéance concernée est dépassée. */
  readonly echeanceDepassee: boolean;
}

/** Écart en jours entre deux dates `YYYY-MM-DD`, sans passer par un fuseau. */
function joursEntre(depuis: string, jusqua: string): number {
  const [ay, am, ad] = depuis.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = jusqua.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * Ce que la bannière doit dire aujourd'hui.
 *
 * ── Pourquoi « raccordement CONFIRMÉ » et pas « configuré » ───────────────
 * Le ticket l'interdit explicitement : ne jamais afficher « vous êtes prêt » à
 * un tenant dont le rattachement n'est pas confirmé par la plateforme. Une clé
 * d'API saisie ne prouve rien — c'est la plateforme qui dit si l'adresse de
 * réception existe. Afficher « prêt » à tort serait la pire des issues : le
 * tenant cesserait de s'en occuper.
 */
export function messageConformite(
  situation: SituationTenant,
  aujourdhui: string,
): MessageConformite {
  if (situation.raccordementConfirme) {
    const joursAvantEmission = joursEntre(aujourdhui, ECHEANCE_EMISSION_PETITES_ENTREPRISES);
    return {
      etat: "PRET",
      titre: "Vous êtes prêt pour la facturation électronique",
      corps:
        joursAvantEmission > 0
          ? "Vous pouvez recevoir les factures de vos fournisseurs. " +
            "L'envoi de vos propres factures par ce canal deviendra obligatoire " +
            "le 1er septembre 2027 — vous n'avez rien à faire d'ici là."
          : "Vous pouvez recevoir et envoyer vos factures par voie électronique.",
      action: null,
      echeanceDepassee: false,
    };
  }

  if (situation.inscritListeAttenteLe) {
    return {
      etat: "EN_ATTENTE",
      titre: "Nous vous préviendrons dès l'ouverture",
      corps:
        "Vous êtes inscrit. Nous vous guiderons pas à pas dès que le " +
        "raccordement sera disponible dans nodaq — vous n'avez rien à surveiller.",
      action: null,
      echeanceDepassee: joursEntre(aujourdhui, ECHEANCE_RECEPTION) < 0,
    };
  }

  const joursAvantReception = joursEntre(aujourdhui, ECHEANCE_RECEPTION);
  if (joursAvantReception >= 0) {
    return {
      etat: "RECEPTION_A_FAIRE",
      titre: "Recevoir vos factures fournisseurs par voie électronique",
      // Le compte à rebours est FACTUEL, pas comminatoire : on dit la date,
      // on ne brandit pas l'amende.
      corps:
        `À partir du 1er septembre 2026, vos fournisseurs pourront vous envoyer ` +
        `leurs factures par voie électronique, et votre entreprise doit pouvoir ` +
        `les recevoir. On s'en occupe avec vous — il y a ${joursAvantReception} jour(s).`,
      action: "Comment ça marche",
      echeanceDepassee: false,
    };
  }

  return {
    etat: "RECEPTION_A_FAIRE",
    titre: "Recevoir vos factures fournisseurs par voie électronique",
    // Passée l'échéance, le ton ne change PAS. Un artisan en retard n'a pas
    // besoin qu'on le lui reproche, il a besoin qu'on l'aide à rattraper.
    corps:
      "Depuis le 1er septembre 2026, vos fournisseurs peuvent vous envoyer " +
      "leurs factures par voie électronique. Votre entreprise doit pouvoir les " +
      "recevoir — on s'en occupe avec vous, c'est rapide.",
    action: "Comment ça marche",
    echeanceDepassee: true,
  };
}

/**
 * Une bannière fermée doit-elle réapparaître ?
 *
 * Elle revient à l'approche de l'échéance concernée, jamais avant. Fermer,
 * c'est dire « pas maintenant », pas « plus jamais » — mais une bannière qui
 * revient tous les jours se ferme par réflexe et cesse d'être lue.
 */
export function doitReapparaitre(
  fermeeLe: string | null,
  etat: EtatConformite,
  aujourdhui: string,
): boolean {
  if (!fermeeLe) return true;
  if (etat === "PRET" || etat === "EN_ATTENTE") return false;

  const echeance =
    etat === "EMISSION_A_VENIR" ? ECHEANCE_EMISSION_PETITES_ENTREPRISES : ECHEANCE_RECEPTION;
  const joursAvant = joursEntre(aujourdhui, echeance);
  // Passée l'échéance, on redevient visible : l'obligation, elle, ne s'est pas
  // périmée avec la date.
  return joursAvant <= JOURS_AVANT_RAPPEL;
}

/**
 * Les trois étapes, en langage d'artisan.
 *
 * Aucun sigle : « PDP », « PPF » et « e-reporting » ne disent rien à quelqu'un
 * qui pose des ardoises, et les employer sans les expliquer est précisément ce
 * que le glossaire du ticket 4.28 interdit.
 */
export const ETAPES_COMMENT_CA_MARCHE: readonly { titre: string; texte: string }[] = [
  {
    titre: "Vos factures fournisseurs arrivent toutes seules",
    texte:
      "Aujourd'hui vous recevez des PDF par e-mail, que vous ressaisissez. " +
      "Demain ils arrivent directement dans nodaq, déjà lus : montant, TVA, " +
      "échéance. Vous n'avez plus qu'à valider.",
  },
  {
    titre: "Vos clients reçoivent les vôtres de la même façon",
    texte:
      "Vos factures partent par le même canal, sans que vous changiez quoi que " +
      "ce soit à votre façon de travailler. C'est nodaq qui s'en charge.",
  },
  {
    titre: "Le raccordement se fait une fois, avec nous",
    texte:
      "Il faut relier votre entreprise au réseau officiel : une inscription, " +
      "votre numéro SIRET, une pièce d'identité. On vous guide, et c'est fini.",
  },
];
