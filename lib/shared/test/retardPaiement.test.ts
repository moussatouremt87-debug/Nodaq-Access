import { describe, test, expect } from "vitest";
import { estRetardSignificatif, seuilRetardSignificatif } from "../src/retardPaiement.js";

describe("estRetardSignificatif — comptant (délai usuel 0 jour)", () => {
  test("significatif dès le lendemain de l'échéance — aucune marge", () => {
    expect(estRetardSignificatif("2026-01-01", "2026-01-02", 0)).toBe(true);
  });

  test("pas encore significatif le jour même de l'échéance", () => {
    expect(estRetardSignificatif("2026-01-01", "2026-01-01", 0)).toBe(false);
  });
});

describe("estRetardSignificatif — B2B standard (délai usuel 30 jours)", () => {
  test("pas significatif un jour après l'échéance — absorbe le cycle du secteur", () => {
    expect(estRetardSignificatif("2026-01-01", "2026-01-02", 30)).toBe(false);
  });

  test("pas significatif exactement 30 jours après l'échéance", () => {
    expect(estRetardSignificatif("2026-01-01", "2026-01-31", 30)).toBe(false);
  });

  test("significatif à 31 jours après l'échéance — dépasse le cycle usuel", () => {
    expect(estRetardSignificatif("2026-01-01", "2026-02-01", 30)).toBe(true);
  });
});

describe("estRetardSignificatif — passage de mois/année, composantes locales", () => {
  test("échéance fin décembre + 30 jours franchit l'année sans décalage", () => {
    expect(estRetardSignificatif("2025-12-15", "2026-01-14", 30)).toBe(false);
    expect(estRetardSignificatif("2025-12-15", "2026-01-15", 30)).toBe(true);
  });
});

describe("seuilRetardSignificatif — équivalent SQL de estRetardSignificatif", () => {
  test("dueDate < seuil ⟺ estRetardSignificatif, sur une grille de cas", () => {
    const cas: Array<[string, string, number]> = [
      ["2026-01-01", "2026-01-02", 0],
      ["2026-01-01", "2026-01-01", 0],
      ["2026-01-01", "2026-01-31", 30],
      ["2026-01-01", "2026-02-01", 30],
      ["2025-12-15", "2026-01-14", 30],
      ["2025-12-15", "2026-01-15", 30],
    ];
    for (const [dueDate, aujourdhui, delai] of cas) {
      const seuil = seuilRetardSignificatif(aujourdhui, delai);
      expect(dueDate < seuil).toBe(estRetardSignificatif(dueDate, aujourdhui, delai));
    }
  });
});
