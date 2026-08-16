/*
 * Prévisionnel de trésorerie (US-A3.5) — MOTEUR PUR.
 *
 * Même doctrine que `recurrence.ts`/`taxCalendar.ts` : des dates et des
 * montants entrent, un prévisionnel sort. Zéro base, zéro horloge implicite
 * — `aujourdhui` est TOUJOURS passé par l'appelant. L'assemblage des
 * données réelles (solde bancaire, factures, échéances, charges) et leur
 * filtrage métier (facture impayée, échéance À_VENIR) sont la
 * responsabilité de la route qui appelle cette fonction — pas la sienne.
 *
 * `soldeDepartCents: null` — pas de compte bancaire connecté — n'est PAS
 * traité comme un solde de zéro : `donneesInsuffisantes` le dit
 * explicitement, et la trajectoire de solde reste `null` semaine par
 * semaine. Inventer un zéro afficherait une trésorerie qui n'existe pas.
 */
import { bornesSemaine, toDateString } from "./dates.js";
import { occurrencesDansFenetre, type Cadence } from "./recurrence.js";

export const PREVISIONNEL_HORIZON_WEEKS = 8;

export interface FactureImpayee {
  readonly id: string;
  readonly dueDate: string;
  /** Toujours le résiduel réel — `residualCents ?? amountCents`, calculé par l'appelant. */
  readonly montantCents: number;
}

export interface EcheanceAVenir {
  readonly id: string;
  readonly label: string;
  readonly dueDate: string;
  /** `null` = non chiffrée — comptée à part, jamais ignorée en silence. */
  readonly estimatedCents: number | null;
}

export interface ChargeRecurrenteProjection {
  readonly id: string;
  readonly label: string;
  readonly cadence: Cadence;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly amountCents: number;
}

export interface PrevisionnelInput {
  /** `null` = aucun compte bancaire connecté. */
  readonly soldeDepartCents: number | null;
  /** `YYYY-MM-DD`, injecté par l'appelant. */
  readonly aujourdhui: string;
  readonly facturesImpayees: readonly FactureImpayee[];
  /** Déjà filtrées au statut À_VENIR par l'appelant — cette fonction n'a pas de notion de statut. */
  readonly echeancesAVenir: readonly EcheanceAVenir[];
  /** Déjà filtrées `active === true` par l'appelant. */
  readonly chargesRecurrentes: readonly ChargeRecurrenteProjection[];
}

export interface MouvementPrevisionnel {
  readonly date: string;
  readonly libelle: string;
  /** Signé : positif = entrée, négatif = sortie. */
  readonly montantCents: number;
  readonly source: "facture" | "echeance" | "charge_recurrente";
  readonly sourceId: string;
}

export interface SemainePrevisionnelle {
  readonly debut: string;
  readonly fin: string;
  readonly entreesCents: number;
  readonly sortiesCents: number;
  /** `null` se propage depuis `soldeDepartCents` — jamais un solde inventé. */
  readonly soldeFinCents: number | null;
  readonly mouvements: readonly MouvementPrevisionnel[];
}

export interface PrevisionnelTresorerie {
  readonly donneesInsuffisantes: boolean;
  readonly from: string;
  readonly to: string;
  readonly soldeDepartCents: number | null;
  readonly semaines: readonly SemainePrevisionnelle[];
  /** Échéances À_VENIR dans la fenêtre mais sans montant estimé — exclues des sorties, comptées ici. */
  readonly unpricedEcheancesCount: number;
}

function ajouterJours(d: Date, jours: number): Date {
  const copie = new Date(d);
  copie.setDate(copie.getDate() + jours);
  return copie;
}

/** `PREVISIONNEL_HORIZON_WEEKS` semaines lundi-dimanche, la première contenant `aujourdhui`. */
function construireSemaines(aujourdhui: Date): { debut: string; fin: string }[] {
  const semaines: { debut: string; fin: string }[] = [];
  for (let i = 0; i < PREVISIONNEL_HORIZON_WEEKS; i += 1) {
    semaines.push(bornesSemaine(ajouterJours(aujourdhui, i * 7)));
  }
  return semaines;
}

function dansFenetre(date: string, debut: string, fin: string): boolean {
  return date >= debut && date <= fin;
}

export function calculerPrevisionnelTresorerie(input: PrevisionnelInput): PrevisionnelTresorerie {
  const aujourdhuiDate = new Date(`${input.aujourdhui}T00:00:00`);
  const bornes = construireSemaines(aujourdhuiDate);
  const from = bornes[0]!.debut;
  const to = bornes[bornes.length - 1]!.fin;

  const mouvementsParSemaine: MouvementPrevisionnel[][] = bornes.map(() => []);
  let unpricedEcheancesCount = 0;

  function verser(date: string, mouvement: MouvementPrevisionnel): void {
    const index = bornes.findIndex((s) => dansFenetre(date, s.debut, s.fin));
    if (index === -1) return; // hors fenêtre — ne peut arriver que sur une erreur d'appelant
    mouvementsParSemaine[index]!.push(mouvement);
  }

  for (const facture of input.facturesImpayees) {
    if (!dansFenetre(facture.dueDate, from, to)) continue;
    verser(facture.dueDate, {
      date: facture.dueDate,
      libelle: "Facture",
      montantCents: facture.montantCents,
      source: "facture",
      sourceId: facture.id,
    });
  }

  for (const echeance of input.echeancesAVenir) {
    if (!dansFenetre(echeance.dueDate, from, to)) continue;
    if (echeance.estimatedCents === null) {
      unpricedEcheancesCount += 1;
      continue;
    }
    verser(echeance.dueDate, {
      date: echeance.dueDate,
      libelle: echeance.label,
      montantCents: -echeance.estimatedCents,
      source: "echeance",
      sourceId: echeance.id,
    });
  }

  for (const charge of input.chargesRecurrentes) {
    const plan = occurrencesDansFenetre(
      { cadence: charge.cadence, startDate: charge.startDate, endDate: charge.endDate },
      from,
      to,
    );
    for (const occurrence of plan.occurrences) {
      verser(occurrence, {
        date: occurrence,
        libelle: charge.label,
        montantCents: -charge.amountCents,
        source: "charge_recurrente",
        sourceId: charge.id,
      });
    }
  }

  let soldeCourant = input.soldeDepartCents;
  const semaines: SemainePrevisionnelle[] = bornes.map((borne, index) => {
    const mouvements = mouvementsParSemaine[index]!;
    const entreesCents = mouvements.filter((m) => m.montantCents > 0).reduce((a, m) => a + m.montantCents, 0);
    // `a - m.montantCents` plutôt que `-somme` : nier une somme vide donnerait
    // -0, distinct de 0 pour `Object.is`/`toBe` — un array vide doit rester un
    // zéro positif ordinaire.
    const sortiesCents = mouvements.filter((m) => m.montantCents < 0).reduce((a, m) => a - m.montantCents, 0);
    soldeCourant = soldeCourant === null ? null : soldeCourant + entreesCents - sortiesCents;
    return {
      debut: borne.debut,
      fin: borne.fin,
      entreesCents,
      sortiesCents,
      soldeFinCents: soldeCourant,
      mouvements,
    };
  });

  return {
    donneesInsuffisantes: input.soldeDepartCents === null,
    from,
    to,
    soldeDepartCents: input.soldeDepartCents,
    semaines,
    unpricedEcheancesCount,
  };
}

/** Convenience pour les appelants : `aujourdhui` du jour, en composantes locales. */
export function aujourdhuiPourPrevisionnel(): string {
  return toDateString(new Date());
}
