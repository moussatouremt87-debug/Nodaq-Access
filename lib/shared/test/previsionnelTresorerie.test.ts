/**
 * `calculerPrevisionnelTresorerie` — prévisionnel de trésorerie sur huit
 * semaines, moteur pur.
 *
 * Ce que ces tests protègent :
 *   a. pas de compte connecté → donneesInsuffisantes, jamais un solde à zéro ;
 *   b. les entrées/sorties restent calculées même sans solde de départ ;
 *   c. une charge récurrente mensuelle atterrit dans la bonne semaine ;
 *   d. une charge trimestrielle hors fenêtre ne produit aucun mouvement ;
 *   e. l'ancrage fin de mois ne réimplémente pas l'arithmétique (borné) ;
 *   f. une échéance non chiffrée est exclue des sorties, comptée à part ;
 *   g. la structure : huit semaines contiguës, la première contient aujourd'hui ;
 *   h. pureté : mêmes entrées → même sortie.
 */
import { describe, test, expect } from "vitest";
import {
  calculerPrevisionnelTresorerie,
  PREVISIONNEL_HORIZON_WEEKS,
  type PrevisionnelInput,
} from "../src/previsionnelTresorerie.js";

const AUJOURDHUI = "2026-08-10"; // un lundi

function entree(overrides: Partial<PrevisionnelInput> = {}): PrevisionnelInput {
  return {
    soldeDepartCents: 500_000,
    aujourdhui: AUJOURDHUI,
    facturesImpayees: [],
    echeancesAVenir: [],
    chargesRecurrentes: [],
    ...overrides,
  };
}

describe("a — pas de compte bancaire connecté", () => {
  test("donneesInsuffisantes est vrai, et aucune semaine n'a de solde inventé", () => {
    const r = calculerPrevisionnelTresorerie(entree({ soldeDepartCents: null }));
    expect(r.donneesInsuffisantes).toBe(true);
    expect(r.soldeDepartCents).toBeNull();
    for (const semaine of r.semaines) {
      expect(semaine.soldeFinCents).toBeNull();
    }
  });
});

describe("b — entrées/sorties calculées même sans solde de départ", () => {
  test("une facture impayée dans la fenêtre compte, même si soldeDepartCents est null", () => {
    const r = calculerPrevisionnelTresorerie(
      entree({
        soldeDepartCents: null,
        facturesImpayees: [{ id: "f1", dueDate: "2026-08-12", montantCents: 100_000 }],
      }),
    );
    expect(r.semaines[0]!.entreesCents).toBe(100_000);
    expect(r.semaines[0]!.soldeFinCents).toBeNull();
  });
});

describe("c — charge récurrente mensuelle dans la bonne semaine", () => {
  test("une charge mensuelle ancrée en semaine 3 n'apparaît que dans cette semaine", () => {
    // Semaine 3 (index 2) : 24-30 août 2026.
    const r = calculerPrevisionnelTresorerie(
      entree({
        chargesRecurrentes: [
          { id: "c1", label: "Loyer", cadence: "mensuel", startDate: "2026-08-26", endDate: null, amountCents: 80_000 },
        ],
      }),
    );
    expect(r.semaines[0]!.sortiesCents).toBe(0);
    expect(r.semaines[1]!.sortiesCents).toBe(0);
    expect(r.semaines[2]!.sortiesCents).toBe(80_000);
    expect(r.semaines[2]!.mouvements).toHaveLength(1);
    expect(r.semaines[2]!.mouvements[0]!.source).toBe("charge_recurrente");
    // Le solde cumulé porte l'impact à partir de cette semaine.
    expect(r.semaines[2]!.soldeFinCents).toBe(500_000 - 80_000);
    expect(r.semaines[3]!.soldeFinCents).toBe(500_000 - 80_000);
  });
});

describe("d — charge trimestrielle hors fenêtre", () => {
  test("aucune occurrence dans les huit semaines → aucun mouvement, totaux inchangés", () => {
    const r = calculerPrevisionnelTresorerie(
      entree({
        chargesRecurrentes: [
          { id: "c1", label: "Assurance", cadence: "trimestriel", startDate: "2026-01-05", endDate: null, amountCents: 30_000 },
        ],
      }),
    );
    for (const semaine of r.semaines) {
      expect(semaine.sortiesCents).toBe(0);
      expect(semaine.mouvements).toHaveLength(0);
    }
    expect(r.semaines[r.semaines.length - 1]!.soldeFinCents).toBe(500_000);
  });
});

describe("e — ancrage fin de mois, arithmétique réutilisée", () => {
  test("une charge ancrée le 31 janvier tombe le 28/29 février dans le prévisionnel, jamais le 3 mars", () => {
    const r = calculerPrevisionnelTresorerie(
      entree({
        aujourdhui: "2026-02-20",
        chargesRecurrentes: [
          { id: "c1", label: "Loyer", cadence: "mensuel", startDate: "2026-01-31", endDate: null, amountCents: 50_000 },
        ],
      }),
    );
    const dates = r.semaines.flatMap((s) => s.mouvements.map((m) => m.date));
    expect(dates).toContain("2026-02-28");
    expect(dates).not.toContain("2026-03-03");
  });
});

describe("f — échéance non chiffrée", () => {
  test("une échéance sans estimatedCents est exclue des sorties et comptée à part", () => {
    const r = calculerPrevisionnelTresorerie(
      entree({
        echeancesAVenir: [
          { id: "e1", label: "TVA", dueDate: "2026-08-12", estimatedCents: null },
        ],
      }),
    );
    expect(r.unpricedEcheancesCount).toBe(1);
    expect(r.semaines[0]!.sortiesCents).toBe(0);
    expect(r.semaines[0]!.mouvements).toHaveLength(0);
  });

  test("une échéance chiffrée compte normalement dans les sorties", () => {
    const r = calculerPrevisionnelTresorerie(
      entree({
        echeancesAVenir: [
          { id: "e1", label: "TVA", dueDate: "2026-08-12", estimatedCents: 45_000 },
        ],
      }),
    );
    expect(r.unpricedEcheancesCount).toBe(0);
    expect(r.semaines[0]!.sortiesCents).toBe(45_000);
  });
});

describe("g — structure des semaines", () => {
  test("exactement huit semaines contiguës, la première contient aujourd'hui", () => {
    const r = calculerPrevisionnelTresorerie(entree());
    expect(r.semaines).toHaveLength(PREVISIONNEL_HORIZON_WEEKS);
    expect(AUJOURDHUI >= r.semaines[0]!.debut && AUJOURDHUI <= r.semaines[0]!.fin).toBe(true);
    for (let i = 1; i < r.semaines.length; i++) {
      const veille = r.semaines[i]!.debut;
      const finPrecedente = r.semaines[i - 1]!.fin;
      const ecart = (new Date(`${veille}T00:00:00Z`).getTime() - new Date(`${finPrecedente}T00:00:00Z`).getTime()) / 86_400_000;
      expect(ecart).toBe(1);
    }
  });
});

describe("h — pureté", () => {
  test("les mêmes entrées produisent toujours la même sortie", () => {
    const input = entree({
      facturesImpayees: [{ id: "f1", dueDate: "2026-08-12", montantCents: 100_000 }],
      chargesRecurrentes: [
        { id: "c1", label: "Loyer", cadence: "mensuel", startDate: "2026-08-05", endDate: null, amountCents: 80_000 },
      ],
    });
    expect(calculerPrevisionnelTresorerie(input)).toEqual(calculerPrevisionnelTresorerie(input));
  });
});

describe("aucune charge récurrente", () => {
  test("un tableau vide est un zéro légitime, pas une insuffisance de données", () => {
    const r = calculerPrevisionnelTresorerie(entree({ chargesRecurrentes: [] }));
    expect(r.donneesInsuffisantes).toBe(false);
    for (const semaine of r.semaines) expect(semaine.sortiesCents).toBe(0);
  });
});

describe("terme de charge en cours de fenêtre", () => {
  test("une charge dont le terme tombe avant sa prochaine occurrence n'apparaît plus", () => {
    const r = calculerPrevisionnelTresorerie(
      entree({
        chargesRecurrentes: [
          { id: "c1", label: "Abonnement", cadence: "mensuel", startDate: "2026-08-05", endDate: "2026-08-06", amountCents: 2_000 },
        ],
      }),
    );
    for (const semaine of r.semaines) expect(semaine.sortiesCents).toBe(0);
  });
});
