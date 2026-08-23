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
}

/** Une échéance à matérialiser. */
export interface EcheanceDue {
  readonly contratId: string;
  readonly echeanceLe: string;
  readonly montantCents: number;
  readonly libelle: string;
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

  if (contrat.amountCents === null || contrat.amountCents <= 0) {
    return ecarte("aucun montant sur le contrat — rien à facturer");
  }

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
      montantCents: contrat.amountCents!,
      libelle: `${contrat.label} — ${periodeFr(echeanceLe)}`,
    })),
    // Une troncature n'est pas un échec : ce qui tient est facturé, et ce qui
    // reste est ANNONCÉ, pour qu'un rattrapage de deux ans ne se termine pas
    // par un silence à la vingt-quatrième facture.
    ecartes: plan.truncated && plan.reason !== null
      ? [{ contratId: contrat.id, motif: plan.reason }]
      : [],
  };
}
