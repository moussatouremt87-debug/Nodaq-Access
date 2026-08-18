/**
 * Quand un appel de relance a le droit de partir — ticket 4.18, US-2/US-5.
 *
 * Module PUR. Le cadre du recouvrement amiable sanctionne l'appel répété ou
 * oppressant : la fenêtre horaire et le plafond de tentatives ne sont pas du
 * confort, ce sont les deux garde-fous qui séparent une relance d'un
 * harcèlement.
 *
 * ── Heures LOCALES, jamais UTC ───────────────────────────────────────────
 * « Neuf heures » veut dire neuf heures chez l'artisan. `getHours()` et
 * `getDay()` lisent les composantes locales ; passer par `toISOString()`
 * décalerait la fenêtre d'une ou deux heures selon la saison, et ferait
 * appeler à huit heures du matin en hiver. C'est la même doctrine que
 * `toDateString` pour les dates métier, et la garde
 * `period-bounds-timezone-guard` veille au grain.
 */

export interface FenetreAppel {
  /** Heure d'ouverture, locale. 9 = « à partir de 9 h ». */
  readonly debutHeure: number;
  /** Heure de fermeture, locale, EXCLUE. 18 = « jusqu'à 17 h 59 ». */
  readonly finHeure: number;
}

export const FENETRE_APPEL_DEFAUT: FenetreAppel = { debutHeure: 9, finHeure: 18 };

/** Plafond de tentatives par débiteur et par campagne (US-2). */
export const TENTATIVES_MAX_DEFAUT = 3;

/** Lundi à vendredi. Un appel de relance le dimanche est indéfendable. */
export function estJourOuvre(instant: Date): boolean {
  const jour = instant.getDay();
  return jour >= 1 && jour <= 5;
}

/**
 * L'appel peut-il partir MAINTENANT ?
 *
 * `finHeure` est exclue : une fenêtre 9-18 autorise jusqu'à 17 h 59, pas
 * 18 h 30. Le débiteur qui décroche à 18 h 01 aurait raison de le prendre
 * mal.
 */
export function dansFenetreAppel(instant: Date, fenetre: FenetreAppel): boolean {
  if (!estJourOuvre(instant)) return false;
  const heure = instant.getHours();
  return heure >= fenetre.debutHeure && heure < fenetre.finHeure;
}

/**
 * La prochaine ouverture de la fenêtre, à partir d'un instant donné.
 *
 * Sert à deux choses : programmer la tentative suivante, et DIRE au débiteur
 * quand on le rappellera — l'US-1 de 4.19 en fait un SMS d'attente. Rendre
 * une date plutôt qu'un délai évite d'avoir à la recalculer à l'affichage.
 */
export function prochaineOuverture(instant: Date, fenetre: FenetreAppel): Date {
  const candidat = new Date(instant.getTime());

  // Aujourd'hui, avant l'ouverture : on attend l'ouverture du jour.
  if (estJourOuvre(candidat) && candidat.getHours() < fenetre.debutHeure) {
    candidat.setHours(fenetre.debutHeure, 0, 0, 0);
    return candidat;
  }

  // Sinon, le prochain jour ouvré à l'heure d'ouverture. La boucle est bornée
  // par construction : sur sept jours consécutifs il y a forcément un jour
  // ouvré, et une boucle non bornée ici gèlerait un worker.
  for (let i = 1; i <= 7; i++) {
    candidat.setDate(candidat.getDate() + 1);
    candidat.setHours(fenetre.debutHeure, 0, 0, 0);
    if (estJourOuvre(candidat)) return candidat;
  }
  // Inatteignable — mais rendre une date invalide vaut mieux que boucler.
  return candidat;
}

export type RefusAppel =
  | "hors_fenetre"
  | "tentatives_epuisees"
  | "opposition"
  | "campagne_non_validee";

export interface EligibiliteAppel {
  readonly autorise: boolean;
  readonly motif?: RefusAppel;
  /** Renseigné quand le refus est temporaire — donc pour `hors_fenetre` seul. */
  readonly reessayerLe?: Date;
}

export interface ContexteAppel {
  readonly maintenant: Date;
  readonly fenetre: FenetreAppel;
  readonly tentativesDejaFaites: number;
  readonly tentativesMax: number;
  readonly opposition: boolean;
  readonly campagneValidee: boolean;
}

/**
 * Cet appel peut-il partir ?
 *
 * L'ordre de vérification est signifiant, et il va du plus définitif au plus
 * temporaire. Une opposition passe avant tout : répondre « hors fenêtre » à
 * quelqu'un qui a demandé à ne plus être appelé laisserait croire qu'on
 * rappellera plus tard. Et la validation de campagne passe avant les
 * tentatives : sans accord du dirigeant, il n'y a pas de première tentative à
 * compter.
 */
export function peutAppeler(ctx: ContexteAppel): EligibiliteAppel {
  if (ctx.opposition) return { autorise: false, motif: "opposition" };
  if (!ctx.campagneValidee) return { autorise: false, motif: "campagne_non_validee" };
  if (ctx.tentativesDejaFaites >= ctx.tentativesMax) {
    return { autorise: false, motif: "tentatives_epuisees" };
  }
  if (!dansFenetreAppel(ctx.maintenant, ctx.fenetre)) {
    return {
      autorise: false,
      motif: "hors_fenetre",
      reessayerLe: prochaineOuverture(ctx.maintenant, ctx.fenetre),
    };
  }
  return { autorise: true };
}

/**
 * Message laissé sur un répondeur (US-5).
 *
 * SANS montant et SANS mention de dette : un répondeur peut être écouté par un
 * conjoint, un enfant, un collègue. La story l'exige, et c'est aussi la seule
 * lecture défendable du secret des affaires — on rappelle qui appelle et
 * pourquoi rappeler, rien de plus.
 */
export function messageRepondeur(nomEntreprise: string, numeroRappel: string): string {
  return (
    `Bonjour, message automatique de ${nomEntreprise}. ` +
    `Nous souhaitons vous joindre au sujet de votre dossier. ` +
    `Merci de nous rappeler au ${numeroRappel}. Bonne journée.`
  );
}

/** Vrai si le message laissé ne divulgue ni montant ni dette. */
export function messageRepondeurEstDiscret(message: string): boolean {
  return !/(impay|dette|facture|€|euros?\b|\d+[.,]\d{2})/i.test(message);
}
