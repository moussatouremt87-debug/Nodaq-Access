/*
 * Facturer les échéances d'un contrat récurrent — US-A2.3.
 *
 * ── Ce qui manquait, exactement ───────────────────────────────────────────
 * Les contrats portaient déjà une cadence, une date de début et un montant, et
 * `recurrence.ts` savait dire quelles échéances étaient dues. Ce qu'aucun code
 * ne faisait : les MATÉRIALISER en factures. Le contrat était un pense-bête,
 * pas une facturation récurrente — l'abonnement se ressaisissait à la main
 * tous les mois, ce qui est précisément le travail que la story supprime.
 *
 * ── Le mot « automatiquement », tenu honnêtement ──────────────────────────
 * Le premier critère dit « quand l'échéance arrive, une facture est générée
 * automatiquement ». Il n'existe AUCUN ordonnanceur dans ce dépôt — ni cron,
 * ni worker, ni `setInterval` côté serveur — et en inventer un pour cette
 * story serait une infrastructure entière livrée en passant, sans supervision
 * ni reprise sur panne.
 *
 * Ce module tient donc la moitié qui lui revient : le CALCUL est entièrement
 * automatique et exhaustif — rien à ressaisir, rien à se rappeler, les
 * échéances en retard sont rattrapées y compris plusieurs mois après. Le
 * déclenchement reste un geste (un bouton, ou un appel de la route par un
 * ordonnanceur externe le jour où il en existera un). La limite est réelle,
 * elle est dite, et elle ne se maquille pas en fonctionnalité complète.
 *
 * ── Générer n'est pas envoyer ─────────────────────────────────────────────
 * Le point d'attention de la story est explicite. Ce qui sort d'ici est un
 * BROUILLON sans numéro : rien n'est scellé, rien n'est parti, et l'émission
 * reste le geste humain qu'elle a toujours été. C'est aussi la chaîne de
 * validation du deuxième critère — la facture existe, elle est relue, et elle
 * n'a d'effet qu'une fois émise.
 */

import { planOccurrences, type Cadence } from "./recurrence.js";

/** Un contrat, réduit à ce qui décide de sa facturation. */
export interface ContratAFacturer {
  readonly id: string;
  readonly label: string;
  readonly cadence: Cadence;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly status: string;
  readonly amountCents: number | null;
  /** Les échéances DÉJÀ facturées, quelles qu'elles soient. */
  readonly dejaFacturees: readonly string[];
  /**
   * Les sites ACTIFS couverts par ce contrat (US-B7.1).
   *
   * Vide = contrat mono-site, le montant global fait foi. Non vide = une ligne
   * PAR SITE sur une facture unique : c'est la « facturation consolidée » que
   * la story demande, et c'est aussi ce qui lève la limite d'US-A2.3 — un
   * contrat n'avait qu'un montant global et aucune ligne.
   */
  readonly sites?: readonly SiteFacturable[];
}

/** Un site couvert par le contrat, avec son montant propre. */
export interface SiteFacturable {
  readonly id: string;
  readonly libelle: string;
  /** `null` = inclus dans le forfait global, pas facturé à part. */
  readonly montantCents: number | null;
}

/** Une ligne de la facture d'échéance — un site, ou le contrat entier. */
export interface LigneEcheance {
  readonly libelle: string;
  readonly montantCents: number;
  /** `null` pour la ligne d'un contrat mono-site. */
  readonly siteId: string | null;
}

/** Une échéance à matérialiser. */
export interface EcheanceDue {
  readonly contratId: string;
  readonly echeanceLe: string;
  /** Le total de l'échéance — somme des lignes. */
  readonly montantCents: number;
  readonly libelle: string;
  /**
   * Le détail. UNE ligne pour un contrat mono-site, une PAR SITE sinon.
   *
   * Le client reçoit alors un document qu'il peut vérifier agence par agence,
   * ce qu'un total unique ne permet pas — et c'est précisément ce qu'un
   * responsable de site conteste quand il ne le retrouve pas.
   */
  readonly lignes: readonly LigneEcheance[];
}

/** Ce qui n'a PAS été facturé, et pourquoi. Jamais silencieux. */
export interface EcheanceEcartee {
  readonly contratId: string;
  readonly motif: string;
}

export interface PlanFacturation {
  readonly dues: readonly EcheanceDue[];
  readonly ecartes: readonly EcheanceEcartee[];
}

/** Le mois d'une échéance, tel qu'on l'écrit sur une facture française. */
const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
] as const;

function periodeFr(iso: string): string {
  const [a, m] = iso.split("-");
  return `${MOIS[Number(m) - 1]} ${a}`;
}

/**
 * Ce qu'un contrat doit facturer aujourd'hui. PURE.
 *
 * ── La résiliation, troisième critère ─────────────────────────────────────
 * « Une résiliation retire la prochaine occurrence automatique sans action
 * manuelle supplémentaire. » Un contrat qui n'est plus `ACTIF` ne produit
 * plus rien — et il n'y a rien à annuler, à dé-planifier ni à nettoyer,
 * puisque aucune occurrence n'a jamais été inscrite quelque part. Résilier,
 * c'est arrêter de générer : l'état du contrat EST le planning.
 *
 * Les échéances déjà facturées AVANT la résiliation restent, évidemment.
 * Elles sont dues.
 *
 * ── Pourquoi les écarts ressortent au lieu de disparaître ────────────────
 * Un contrat sans montant ou sans date de début ne peut pas être facturé.
 * L'ignorer en silence ferait croire à un abonnement suivi alors qu'il ne
 * l'est pas — et personne ne le découvrirait avant le trou de trésorerie.
 */
export function echeancesAFacturer(
  contrat: ContratAFacturer,
  aujourdhui: string,
): PlanFacturation {
  const ecarte = (motif: string): PlanFacturation => ({
    dues: [],
    ecartes: [{ contratId: contrat.id, motif }],
  });

  // Un contrat suspendu ou terminé ne génère plus rien. Muet, et c'est voulu :
  // ce n'est pas un défaut à signaler, c'est la décision de l'utilisateur.
  if (contrat.status !== "ACTIF") return { dues: [], ecartes: [] };

  // ── Ce que l'échéance facture : les sites, ou le contrat ────────────────
  // Un site sans montant propre est INCLUS dans le forfait global : il se
  // planifie, il ne se facture pas à part. L'inscrire à zéro sur la facture
  // ferait croire à une prestation gratuite.
  const sitesFactures = (contrat.sites ?? []).filter(
    (s): s is SiteFacturable & { montantCents: number } =>
      s.montantCents !== null && s.montantCents > 0,
  );

  const lignesModele: readonly LigneEcheance[] = sitesFactures.length > 0
    ? sitesFactures.map((s) => ({
        libelle: s.libelle, montantCents: s.montantCents, siteId: s.id,
      }))
    : contrat.amountCents !== null && contrat.amountCents > 0
      ? [{ libelle: contrat.label, montantCents: contrat.amountCents, siteId: null }]
      : [];

  if (lignesModele.length === 0) {
    return ecarte(
      (contrat.sites ?? []).length > 0
        ? "aucun site facturé et aucun montant sur le contrat — rien à facturer"
        : "aucun montant sur le contrat — rien à facturer",
    );
  }

  const totalCents = lignesModele.reduce((s, l) => s + l.montantCents, 0);

  // Le plan repart de la DERNIÈRE échéance facturée. Un trou plus ancien ne se
  // rattrape donc pas ici : c'est le prix d'un curseur unique, et il est
  // préférable au risque inverse — refacturer une échéance déjà réglée.
  const derniere = contrat.dejaFacturees.length === 0
    ? null
    : [...contrat.dejaFacturees].sort().at(-1)!;

  const plan = planOccurrences(
    {
      cadence: contrat.cadence,
      startDate: contrat.startDate,
      endDate: contrat.endDate,
      lastOccurrenceDate: derniere,
    },
    aujourdhui,
  );

  if (plan.due.length === 0) {
    // `reason` n'est non nul que s'il y a quelque chose à expliquer — un refus
    // ou une troncature. Rien à dire signifie : à jour, tout simplement.
    return plan.reason === null ? { dues: [], ecartes: [] } : ecarte(plan.reason);
  }

  return {
    dues: plan.due.map((echeanceLe) => ({
      contratId: contrat.id,
      echeanceLe,
      montantCents: totalCents,
      libelle: `${contrat.label} — ${periodeFr(echeanceLe)}`,
      // La période est portée par CHAQUE ligne : sur une facture de huit
      // agences, un libellé de site seul ne dirait pas de quel mois il s'agit.
      lignes: lignesModele.map((l) => ({
        ...l, libelle: `${l.libelle} — ${periodeFr(echeanceLe)}`,
      })),
    })),
    // Une troncature n'est pas un échec : ce qui tient est facturé, et ce qui
    // reste est ANNONCÉ, pour qu'un rattrapage de deux ans ne se termine pas
    // par un silence à la vingt-quatrième facture.
    ecartes: plan.truncated && plan.reason !== null
      ? [{ contratId: contrat.id, motif: plan.reason }]
      : [],
  };
}
