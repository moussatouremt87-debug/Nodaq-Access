/*
 * La ligne « Production vendue – services (70) » du compte de résultat.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 * Cette ligne était calculée en trois lignes de `filter/reduce` au milieu
 * d'une route, sans un seul test — dans un fichier qui produit un document
 * comptable. L'audit du backlog (US-A1.2, critère 3) a demandé d'y faire
 * entrer le chiffre d'affaires repris ; on ne pose pas un chiffre juste sur
 * une ligne fausse, donc les trois défauts trouvés au passage sont corrigés
 * ici, et chacun est éprouvé.
 *
 * ── Défaut 1 : les BROUILLONS comptaient comme du chiffre d'affaires ──────
 * Le filtre ne regardait que les dates. Une facture jamais émise — donc
 * jamais envoyée, jamais due, sans numéro — gonflait le résultat. La
 * facturation récurrente (US-A2.3) rend ce défaut systématique : rattraper
 * quatre mois d'abonnement crée quatre brouillons, et le compte de résultat
 * aurait affiché quatre mois de produits que personne ne doit.
 *
 * ── Défaut 2 : le TTC était compté comme du HT ────────────────────────────
 * `amountCents` est le total TTC (le commentaire du schéma le dit). Un compte
 * de résultat enregistre des produits HORS TAXES : la TVA collectée n'est pas
 * un produit, c'est une dette envers l'État. La ligne était donc surévaluée
 * d'environ 20 % — assez pour fausser un résultat, un acompte d'IS, et la
 * conversation avec un comptable.
 *
 * ── Défaut 3 : les avoirs n'étaient jamais déduits ────────────────────────
 * Un avoir annule ou réduit une facture. L'ignorer laisse au compte de
 * résultat un produit que l'entreprise a formellement repris.
 *
 * ── Et l'ajout demandé : le chiffre d'affaires repris ─────────────────────
 * US-A1.2 : « étant donné une reprise complétée, quand l'utilisateur consulte
 * son compte de résultat, alors les montants repris apparaissent bien dans le
 * premier exercice affiché ». Sans lui, une entreprise qui migre en cours
 * d'année voit un compte de résultat amputé de tout ce qu'elle a facturé
 * avant d'arriver — c'est-à-dire l'essentiel, et c'est précisément ce qui
 * décourage de migrer.
 */

/** Les statuts qui constituent un PRODUIT. Un brouillon n'en est pas un. */
export const STATUTS_PRODUITS = ["EMISE", "ENVOYEE", "PAYEE"] as const;

/** Une facture, réduite à ce qui décide de sa contribution au résultat. */
export interface FacturePourResultat {
  readonly issuedDate: string;
  readonly statut: string;
  readonly totalHTCents: number;
  /** Total TTC. Repli des lignes antérieures à `total_ht_cents`. */
  readonly amountCents: number;
}

export interface AvoirPourResultat {
  readonly issuedDate: string;
  readonly montantHtCents: number;
}

/** Ce que l'utilisateur a déclaré avoir déjà facturé ailleurs. */
export interface RepriseCA {
  /** En EUROS — c'est ainsi que l'onboarding l'enregistre. */
  readonly caFactureEuros: number | null;
  /** Sans elle, le montant ne peut être rattaché à aucun exercice. */
  readonly dateDebutExercice: string | null;
}

export interface ProductionVendue {
  readonly totalCents: number;
  /** Part venant des factures émises dans nodaq, avoirs déduits. */
  readonly factureCents: number;
  /** Part venant de la reprise d'historique. Zéro hors premier exercice. */
  readonly reprisCents: number;
  /**
   * Français, non nul dès qu'il y a quelque chose à dire à l'utilisateur.
   * Un montant repris qu'on ne sait pas dater n'est pas jeté en silence : il
   * est ANNONCÉ, avec ce qu'il faut faire pour le rattacher.
   */
  readonly avertissement: string | null;
}

const dansLaPeriode = (d: string, du: string, au: string): boolean => d >= du && d <= au;

/**
 * Le montant HT d'une facture.
 *
 * `total_ht_cents` est `NOT NULL DEFAULT 0` : les lignes créées avant son
 * introduction valent donc 0, et prendre 0 pour argent comptant effacerait
 * leur chiffre d'affaires. On retombe alors sur `amountCents`, qui est le
 * comportement HISTORIQUE de cette ligne — pas exact (c'est du TTC), mais
 * aucune régression pour ces lignes-là, et la seule valeur dont on dispose.
 */
function htCents(f: FacturePourResultat): number {
  return f.totalHTCents > 0 ? f.totalHTCents : f.amountCents;
}

export function productionVendue(
  factures: readonly FacturePourResultat[],
  avoirs: readonly AvoirPourResultat[],
  reprise: RepriseCA,
  du: string,
  au: string,
): ProductionVendue {
  const produits = (STATUTS_PRODUITS as readonly string[]);

  const facture = factures
    .filter((f) => dansLaPeriode(f.issuedDate, du, au) && produits.includes(f.statut))
    .reduce((acc, f) => acc + htCents(f), 0);

  const avoir = avoirs
    .filter((a) => dansLaPeriode(a.issuedDate, du, au))
    .reduce((acc, a) => acc + a.montantHtCents, 0);

  const factureCents = facture - avoir;

  // ── La reprise, et la seule période où elle a sa place ──────────────────
  // « Le PREMIER exercice affiché » : celui qui contient le début de
  // l'exercice déclaré. L'ajouter à chaque période la compterait autant de
  // fois qu'on change de filtre — et personne ne verrait passer l'erreur.
  const montant = reprise.caFactureEuros;
  if (montant === null || montant === 0) {
    return { totalCents: factureCents, factureCents, reprisCents: 0, avertissement: null };
  }

  if (reprise.dateDebutExercice === null) {
    // Écarté, mais DIT. Un montant repris qui disparaît sans un mot laisse
    // l'utilisateur devant un compte de résultat amputé sans savoir pourquoi.
    return {
      totalCents: factureCents, factureCents, reprisCents: 0,
      avertissement:
        `${montant.toLocaleString("fr-FR")} € repris ne sont rattachés à aucun exercice : ` +
        "renseignez la date de début d'exercice dans la reprise pour qu'ils apparaissent ici.",
    };
  }

  if (!dansLaPeriode(reprise.dateDebutExercice, du, au)) {
    return { totalCents: factureCents, factureCents, reprisCents: 0, avertissement: null };
  }

  // Euros → centimes. `Math.round` et non une troncature : 85 000,5 € doit
  // donner 8 500 050 centimes, pas 8 500 049.
  const reprisCents = Math.round(montant * 100);
  return {
    totalCents: factureCents + reprisCents,
    factureCents,
    reprisCents,
    avertissement:
      `Dont ${montant.toLocaleString("fr-FR")} € repris de votre outil précédent, ` +
      "déclarés lors de la mise en route.",
  };
}
