/*
 * Relancer un devis resté sans réponse — ticket 4.33.
 *
 * « Si je choisis les statuts prospect, devis envoyé, devis accepté, on doit
 * prévoir une relance du client par email et WhatsApp. »
 *
 * ── Ce que ce module fait, et ne fait pas ─────────────────────────────────
 * Il DÉCIDE qui relancer et RÉDIGE le message. Il n'envoie rien, ne touche
 * aucune base, ne lit aucune horloge : `aujourdhui` est un paramètre, comme
 * partout où ce dépôt calcule sur des dates. C'est ce qui le rend éprouvable
 * sans base ni faux temps.
 *
 * L'envoi passe par une `pending_action` à valider (règle 4) : relancer un
 * client est un geste commercial qui engage, pas une notification.
 */

/** Le minimum qu'il faut savoir d'un devis pour décider de le relancer. */
export interface DevisRelancable {
  readonly id: string;
  readonly reference: string;
  readonly clientNom: string;
  readonly clientTelephone: string | null;
  readonly statut: string;
  /** `YYYY-MM-DD`, ou `null` si le devis n'a jamais été envoyé. */
  readonly dateEnvoi: string | null;
  /** `YYYY-MM-DD` — au-delà, le devis ne vaut plus rien à relancer. */
  readonly validUntil: string | null;
  readonly totalTTCCents: number;
  /** Une relance déjà proposée pour ce devis, `YYYY-MM-DD`. */
  readonly derniereRelance: string | null;
}

/** Écart en jours entre deux dates `YYYY-MM-DD`, sans passer par un fuseau. */
export function joursEntre(depuis: string, jusqua: string): number {
  const [ay, am, ad] = depuis.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = jusqua.split("-").map(Number) as [number, number, number];
  // `Date.UTC` et non `new Date(...)` : on compare des jours calendaires, et
  // une construction locale décale d'un jour près des changements d'heure.
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export type MotifNonRelance =
  | "pas_envoye"
  | "delai_non_atteint"
  | "expire"
  | "deja_relance";

export interface Decision {
  readonly devis: DevisRelancable;
  readonly relancer: boolean;
  readonly motif: MotifNonRelance | null;
  readonly joursSansReponse: number;
}

/**
 * Faut-il relancer ce devis ?
 *
 * Quatre refus, et chacun évite un message qui ferait mauvais effet :
 *
 * - **pas envoyé** — un brouillon n'a jamais atteint le client ; le relancer
 *   reviendrait à lui reprocher un silence sur un document qu'il n'a pas reçu.
 * - **délai non atteint** — relancer trop tôt est le meilleur moyen de perdre
 *   une affaire qu'on était en train de gagner.
 * - **expiré** — un devis dont la validité est passée ne se relance pas, il se
 *   refait. Le prix a pu changer, et réclamer une réponse sur un tarif qu'on
 *   ne tiendra plus est un piège qu'on se tend à soi-même.
 * - **déjà relancé** — une seule relance par période. Deux messages pour le
 *   même devis, c'est du harcèlement, pas du commerce.
 */
export function decider(
  devis: DevisRelancable,
  delaiJours: number,
  aujourdhui: string,
): Decision {
  const nulle = { devis, relancer: false, joursSansReponse: 0 } as const;

  if (devis.statut !== "ENVOYE" || !devis.dateEnvoi) {
    return { ...nulle, motif: "pas_envoye" };
  }

  const joursSansReponse = joursEntre(devis.dateEnvoi, aujourdhui);
  if (joursSansReponse < delaiJours) {
    return { ...nulle, motif: "delai_non_atteint", joursSansReponse };
  }
  if (devis.validUntil && devis.validUntil < aujourdhui) {
    return { ...nulle, motif: "expire", joursSansReponse };
  }
  // Le délai sert AUSSI d'espacement entre deux relances : sans ça, chaque
  // exécution de la campagne reproposerait les mêmes devis.
  if (devis.derniereRelance && joursEntre(devis.derniereRelance, aujourdhui) < delaiJours) {
    return { ...nulle, motif: "deja_relance", joursSansReponse };
  }

  return { devis, relancer: true, motif: null, joursSansReponse };
}

export interface MessageRelance {
  readonly objet: string;
  readonly corps: string;
  /** `https://wa.me/…` prérempli, ou `null` faute de numéro exploitable. */
  readonly lienWhatsApp: string | null;
}

/**
 * Un numéro français au format international, sans `+` ni séparateur.
 *
 * `wa.me` n'accepte que ça. Un numéro qu'on ne sait pas normaliser rend
 * `null` : mieux vaut pas de lien qu'un lien qui ouvre une conversation avec
 * un inconnu.
 */
export function numeroPourWhatsApp(brut: string | null): string | null {
  if (!brut) return null;
  const chiffres = brut.replace(/[^\d+]/g, "");
  if (chiffres.startsWith("+")) {
    const sans = chiffres.slice(1);
    return /^\d{10,15}$/.test(sans) ? sans : null;
  }
  // 0X XX XX XX XX → 33XXXXXXXXX. Uniquement le format national français :
  // deviner l'indicatif d'un numéro étranger écrit sans lui serait inventer.
  if (/^0\d{9}$/.test(chiffres)) return `33${chiffres.slice(1)}`;
  return null;
}

/**
 * Le message de relance. Aucun chiffre n'y entre qui ne vienne du devis.
 *
 * Le ton est celui d'une question, pas d'une réclamation : à ce stade le
 * client n'a rien promis. Un devis sans réponse n'est pas un impayé, et le
 * confondre abîme une relation commerciale encore ouverte.
 */
export function redigerRelance(
  d: DevisRelancable,
  joursSansReponse: number,
  nomEntreprise: string,
): MessageRelance {
  const montant = `${(d.totalTTCCents / 100).toFixed(2)} €`;
  const objet = `Votre devis ${d.reference} — ${nomEntreprise}`;
  const corps = [
    `Bonjour,`,
    ``,
    `Je reviens vers vous au sujet du devis ${d.reference}, d'un montant de ${montant} TTC,`,
    `que je vous ai adressé il y a ${joursSansReponse} jours.`,
    ``,
    `Avez-vous eu le temps d'en prendre connaissance ? Si un point mérite d'être ajusté,`,
    `dites-le moi : c'est plus simple d'en parler que de rester sur une hésitation.`,
    ``,
    `Bien cordialement,`,
    nomEntreprise,
  ].join("\n");

  const numero = numeroPourWhatsApp(d.clientTelephone);
  // Message court pour WhatsApp : personne ne lit un courrier dans une bulle.
  const texteCourt =
    `Bonjour, je reviens vers vous au sujet du devis ${d.reference} ` +
    `(${montant} TTC). Avez-vous pu y jeter un œil ? — ${nomEntreprise}`;

  return {
    objet,
    corps,
    lienWhatsApp: numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texteCourt)}` : null,
  };
}
