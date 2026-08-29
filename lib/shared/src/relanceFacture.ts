/**
 * Le RECOUVREMENT d'une facture impayée — l'échelonnement, et les mots.
 *
 * ── CE QUI MANQUAIT ────────────────────────────────────────────────────────
 * Une facture qui dépassait son échéance ne provoquait RIEN. L'écran Factures
 * l'affichait « impayée » et n'offrait aucune action ; le seul chemin de
 * recouvrement existant était une campagne d'APPELS, déclenchable uniquement
 * en dictant une phrase à l'agent. Autant dire introuvable.
 *
 * Signalé par le fondateur le 29/08/2026 : « en tant qu'utilisateur, ça doit
 * se faire automatiquement sans que j'aie besoin de chercher comment faire ».
 *
 * ── L'ÉCHELONNEMENT, TEL QU'IL A ÉTÉ DÉCRIT ────────────────────────────────
 *   J+0   (échéance dépassée) → e-mail ET WhatsApp, en parallèle
 *   J+15  (sans réponse)      → second e-mail ET second WhatsApp
 *   J+30  (sans réponse)      → appel téléphonique
 *
 * Les paliers vivent ICI, en un seul endroit, et non dispersés dans une route
 * et un ordonnanceur. Ce fichier a déjà vu ce qui arrive quand une même règle
 * est écrite deux fois : les deux divergent, et l'une ment.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ───────────────────────────────────────────
 * Il n'envoie rien et ne décide rien d'irréversible. Il dit QUEL palier
 * s'applique et RÉDIGE le message. L'envoi passe par une action à valider :
 * la règle 4 du dépôt interdit qu'un message parte chez un client sans que
 * l'artisan l'ait lu — et un litige, un paiement croisé ou une erreur de
 * montant partiraient sinon tout seuls.
 */

/** Les canaux d'un palier. `appel` n'envoie rien : il prépare une campagne. */
export type CanalRecouvrement = "email" | "whatsapp" | "appel";

export interface PalierRecouvrement {
  /** Rang, à partir de 1 — sert à savoir où en est un dossier. */
  readonly niveau: 1 | 2 | 3;
  /** Jours de RETARD à partir desquels ce palier s'applique. */
  readonly apresJoursDeRetard: number;
  readonly canaux: readonly CanalRecouvrement[];
  /** Ce que l'artisan lit dans la file de validation. */
  readonly intitule: string;
}

/**
 * L'échelle, dans l'ordre. Un mois pour passer de l'échéance à l'appel.
 *
 * Les délais sont des CONSTANTES et non des réglages : tant qu'un tenant n'a
 * pas exprimé un besoin différent, un paramètre de plus est une case à remplir
 * de plus. `regles_relance` porte déjà `retardMaxJours` pour d'autres usages ;
 * le jour où ces paliers devront varier, c'est là qu'ils iront — pas dans un
 * second réglage parallèle.
 */
export const PALIERS_RECOUVREMENT: readonly PalierRecouvrement[] = [
  {
    niveau: 1,
    apresJoursDeRetard: 0,
    canaux: ["email", "whatsapp"],
    intitule: "Première relance",
  },
  {
    niveau: 2,
    apresJoursDeRetard: 15,
    canaux: ["email", "whatsapp"],
    intitule: "Seconde relance",
  },
  {
    niveau: 3,
    apresJoursDeRetard: 30,
    canaux: ["appel"],
    intitule: "Relance téléphonique",
  },
] as const;

/**
 * Le palier qui s'applique — ou `null` quand il n'y a rien à faire.
 *
 * ── POURQUOI LE DERNIER PALIER FRANCHI, ET PAS LE SUIVANT ──────────────────
 * Une facture découverte à J+40 n'a jamais reçu de relance. Lui envoyer
 * d'emblée l'appel téléphonique sauterait les deux e-mails — or l'appel est
 * l'étape qui coûte le plus cher à la relation client, et la loi comme l'usage
 * veulent qu'on écrive avant d'appeler. On applique donc le PROCHAIN palier
 * dû, pas le plus élevé atteignable.
 *
 * `dejaEnvoyes` est le nombre de relances déjà parties pour cette facture.
 * C'est lui qui fait avancer le dossier, pas le seul calendrier : une facture
 * relancée hier ne doit pas l'être à nouveau aujourd'hui parce qu'elle a
 * franchi un seuil.
 */
export function palierApplicable(
  joursDeRetard: number,
  dejaEnvoyes: number,
): PalierRecouvrement | null {
  if (joursDeRetard < 0) return null;          // pas encore échue
  if (dejaEnvoyes >= PALIERS_RECOUVREMENT.length) return null;   // échelle épuisée

  const prochain = PALIERS_RECOUVREMENT[dejaEnvoyes];
  if (!prochain) return null;
  // Le seuil du prochain palier doit être atteint. À J+3 avec une relance déjà
  // partie, on attend J+15 : relancer tous les jours n'est pas du
  // recouvrement, c'est du harcèlement.
  return joursDeRetard >= prochain.apresJoursDeRetard ? prochain : null;
}

/**
 * Ce qu'il faut d'une facture pour la relancer.
 *
 * `FactureARelancer` et non `FactureImpayee` : ce dernier nom est déjà pris
 * par le prévisionnel de trésorerie, qui en a une définition différente. Deux
 * types homonymes aux champs distincts finissent toujours par être confondus
 * à l'import.
 */
export interface FactureARelancer {
  readonly numero: string;
  readonly clientNom: string;
  readonly montantTTCCents: number;
  /** Date d'échéance, au format AAAA-MM-JJ. */
  readonly dateEcheance: string;
}

export interface MessageRecouvrement {
  readonly objet: string;
  readonly corps: string;
  /** Version courte, pour WhatsApp — un pavé ne s'y lit pas. */
  readonly texteWhatsApp: string;
}

/**
 * Le message d'un palier.
 *
 * ── LE TON MONTE, LES FAITS NE CHANGENT PAS ────────────────────────────────
 * Le montant, le numéro et l'échéance sont les mêmes à chaque palier : ce sont
 * des faits, ils viennent de la facture. Seule la formulation se durcit. Un
 * message qui changerait de chiffre entre deux relances détruirait la
 * crédibilité de la créance — et c'est exactement ce qu'un texte reformulé par
 * un modèle finirait par faire.
 *
 * Aucun chiffre n'est calculé ici : le montant est recopié, la date aussi.
 */
export function redigerRecouvrement(
  facture: FactureARelancer,
  palier: PalierRecouvrement,
  joursDeRetard: number,
  nomEntreprise: string,
): MessageRecouvrement {
  const montant = `${(facture.montantTTCCents / 100).toFixed(2)} €`;
  const objet =
    palier.niveau === 1
      ? `Facture ${facture.numero} échue — ${nomEntreprise}`
      : `Relance — facture ${facture.numero} impayée depuis ${joursDeRetard} jours`;

  const ouverture =
    palier.niveau === 1
      ? [
          `La facture ${facture.numero}, d'un montant de ${montant} TTC, est arrivée à échéance le ${facture.dateEcheance}.`,
          ``,
          `Il s'agit peut-être d'un simple oubli. Si le règlement est déjà parti, merci de ne pas tenir compte de ce message.`,
        ]
      : [
          `Malgré notre précédente relance, la facture ${facture.numero}, d'un montant de ${montant} TTC,`,
          `demeure impayée depuis ${joursDeRetard} jours.`,
          ``,
          `Nous vous remercions de procéder à son règlement, ou de nous indiquer la difficulté rencontrée.`,
        ];

  const corps = [`Bonjour,`, ``, ...ouverture, ``, `Cordialement,`, nomEntreprise].join("\n");

  const texteWhatsApp =
    palier.niveau === 1
      ? `Bonjour, la facture ${facture.numero} (${montant} TTC) est arrivée à échéance le ${facture.dateEcheance}. ` +
        `S'il s'agit d'un oubli, merci de régulariser. ${nomEntreprise}`
      : `Bonjour, la facture ${facture.numero} (${montant} TTC) reste impayée depuis ${joursDeRetard} jours. ` +
        `Pouvez-vous nous indiquer où en est le règlement ? ${nomEntreprise}`;

  return { objet, corps, texteWhatsApp };
}

/**
 * Jours de retard d'une facture, à une date donnée.
 *
 * Les deux dates sont des JOURS CALENDAIRES (AAAA-MM-JJ), comparés comme tels.
 * Passer par des `Date` ferait entrer le fuseau du serveur dans un calcul qui
 * n'en dépend pas : une échéance au 29 août est dépassée le 30, à Paris comme
 * à Auckland. Le dépôt a déjà payé ce genre d'erreur — voir la garde
 * `period-bounds-timezone-guard`.
 */
export function joursDeRetard(dateEcheance: string, aujourdhui: string): number {
  const j = (s: string): number => {
    const [a, m, d] = s.split("-").map(Number);
    return Date.UTC(a ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000;
  };
  return Math.round(j(aujourdhui) - j(dateEcheance));
}
