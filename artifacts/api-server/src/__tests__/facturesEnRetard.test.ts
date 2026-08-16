/**
 * `estFactureEnRetard` (US-A3.1) — définition canonique, testée en pur pour
 * ne pas dépendre de la base. Le pendant SQL (`conditionFactureEnRetardSql`)
 * est exercé indirectement via `facturation.test.ts` (describe "l") et
 * `factures.ts` (`totalOverdueCents`) — mêmes scénarios dueDate
 * future/passée, sur les deux chemins, pour donner confiance qu'ils
 * s'accordent sans dupliquer un test d'intégration ici.
 */
import { describe, test, expect } from "vitest";
import { estFactureEnRetard, residuelFactureCents } from "../lib/facturesEnRetard";

describe("estFactureEnRetard", () => {
  test("dueDate strictement avant aujourd'hui, statut EMISE → en retard", () => {
    expect(estFactureEnRetard({ statut: "EMISE", dueDate: "2026-01-01" }, "2026-01-02")).toBe(true);
  });

  test("dueDate === aujourd'hui → pas encore en retard (US-A3.4)", () => {
    expect(estFactureEnRetard({ statut: "EMISE", dueDate: "2026-01-02" }, "2026-01-02")).toBe(false);
  });

  test("dueDate future → pas en retard", () => {
    expect(estFactureEnRetard({ statut: "EMISE", dueDate: "2026-02-01" }, "2026-01-02")).toBe(false);
  });

  test("statut PAYEE, dueDate ancienne → jamais en retard", () => {
    expect(estFactureEnRetard({ statut: "PAYEE", dueDate: "2020-01-01" }, "2026-01-02")).toBe(false);
  });

  test("statut ANNULEE_PAR_AVOIR, dueDate ancienne → jamais en retard", () => {
    expect(estFactureEnRetard({ statut: "ANNULEE_PAR_AVOIR", dueDate: "2020-01-01" }, "2026-01-02")).toBe(false);
  });

  test("statut BROUILLON, dueDate ancienne → en retard (le brouillon n'est pas exclu de la liste)", () => {
    expect(estFactureEnRetard({ statut: "BROUILLON", dueDate: "2020-01-01" }, "2026-01-02")).toBe(true);
  });
});

describe("residuelFactureCents", () => {
  test("résiduel présent → priorité au résiduel, pas au montant total", () => {
    expect(residuelFactureCents({ residualCents: 3_000, amountCents: 10_000 })).toBe(3_000);
  });

  test("résiduel absent (null) → replie sur le montant total", () => {
    expect(residuelFactureCents({ residualCents: null, amountCents: 10_000 })).toBe(10_000);
  });

  test("résiduel à zéro → 0, pas un repli sur le montant total (facture soldée)", () => {
    expect(residuelFactureCents({ residualCents: 0, amountCents: 10_000 })).toBe(0);
  });
});
