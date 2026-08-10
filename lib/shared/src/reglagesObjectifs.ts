/*
 * Réglages des objectifs — L'UNITÉ EST DANS LE NOM, ET LES BORNES SONT ICI.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Constaté en écrivant `35` au lieu de `3500` : l'application a affiché,   ║
 * ║  sans broncher, un seuil de rentabilité de 13 714 286 €.                  ║
 * ║                                                                           ║
 * ║  Le calcul était juste — c'est l'ENTRÉE qui était absurde, et rien ne     ║
 * ║  l'a refusée.                                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Deux corrections, indissociables.
 *
 * L'UNITÉ DANS LE NOM. `objectifs.taux_marge` était rangé en centièmes de
 * point et `objectifs.charges_fixes_annuelles` en centimes, derrière des noms
 * qui ne le disaient pas. Le formulaire convertissait correctement — mais rien
 * ne protégeait une valeur arrivant autrement : une reprise de données, une
 * intervention de support, ou la couche vocale. Les clés portent désormais
 * `_bp` et `_cents`.
 *
 * LES BORNES, CÔTÉ SERVEUR. Un formulaire qui convertit bien n'est pas une
 * garde : `PATCH /parametres` accepte n'importe quelle paire clé/valeur.
 * C'est la route qui refuse, pas l'écran.
 */

/** Clé du taux de marge, en POINTS DE BASE (3500 = 35 %). */
export const CLE_TAUX_MARGE = "objectifs.taux_marge_bp";

/** Clé des charges fixes annuelles, en CENTIMES. */
export const CLE_CHARGES_FIXES = "objectifs.charges_fixes_annuelles_cents";

/** Anciennes clés, sans unité. Conservées pour la reprise et la garde. */
export const ANCIENNE_CLE_TAUX_MARGE = "objectifs.taux_marge";
export const ANCIENNE_CLE_CHARGES_FIXES = "objectifs.charges_fixes_annuelles";

/**
 * Taux de marge sur coûts variables : de 1 % à 100 %.
 *
 * Sous 1 %, ce n'est pas une marge, c'est une erreur de saisie — et c'est
 * exactement le cas observé : `35` points de base valent 0,35 %, ce qui divise
 * les charges par 0,0035 et produit un seuil vingt fois trop grand.
 * Au-delà de 100 %, la notion n'a pas de sens.
 */
export const TAUX_MARGE_BP_MIN = 100;
export const TAUX_MARGE_BP_MAX = 10_000;

/**
 * Charges fixes annuelles : de 1 000 € à 2 000 000 €.
 *
 * La fourchette vise une TPE du bâtiment de 3 à 15 salariés. En dessous de
 * 1 000 € par an, ce ne sont pas des charges fixes d'entreprise ; au-dessus de
 * 2 000 000 €, ce n'est plus une TPE — dans les deux cas la valeur vient d'une
 * unité confondue, pas d'une entreprise réelle.
 */
export const CHARGES_FIXES_CENTS_MIN = 100_000;
export const CHARGES_FIXES_CENTS_MAX = 200_000_000;

export interface RefusReglage {
  readonly cle: string;
  readonly message: string;
}

/**
 * Contrôle une valeur de réglage d'objectif. Rend `null` si elle est
 * acceptable, un refus lisible sinon.
 *
 * Les clés inconnues rendent `null` : cette fonction ne juge QUE les réglages
 * d'objectif, et n'a pas à se prononcer sur le reste.
 */
export function verifierReglageObjectif(cle: string, brut: string): RefusReglage | null {
  if (cle !== CLE_TAUX_MARGE && cle !== CLE_CHARGES_FIXES) return null;

  const n = Number(brut);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { cle, message: `${cle} doit être un entier.` };
  }

  if (cle === CLE_TAUX_MARGE) {
    if (n < TAUX_MARGE_BP_MIN || n > TAUX_MARGE_BP_MAX) {
      return {
        cle,
        message:
          `Le taux de marge doit être compris entre 1 % et 100 %, exprimé en points de base ` +
          `(${TAUX_MARGE_BP_MIN} à ${TAUX_MARGE_BP_MAX}). Reçu : ${n}. ` +
          `Un taux de 35 % s'écrit 3500, pas 35.`,
      };
    }
    return null;
  }

  if (n < CHARGES_FIXES_CENTS_MIN || n > CHARGES_FIXES_CENTS_MAX) {
    return {
      cle,
      message:
        `Les charges fixes annuelles doivent être comprises entre ` +
        `${CHARGES_FIXES_CENTS_MIN / 100} € et ${CHARGES_FIXES_CENTS_MAX / 100} €, ` +
        `exprimées en centimes. Reçu : ${n}.`,
    };
  }
  return null;
}

/** Contrôle un lot de réglages. Rend tous les refus, pas seulement le premier. */
export function verifierReglagesObjectifs(
  reglages: Readonly<Record<string, string>>,
): RefusReglage[] {
  return Object.entries(reglages)
    .map(([cle, valeur]) => verifierReglageObjectif(cle, valeur))
    .filter((r): r is RefusReglage => r !== null);
}
