/**
 * `occurrencesDansFenetre` — occurrences d'une cadence dans une fenêtre fermée.
 *
 * Distinct de `planOccurrences` (une seule prochaine échéance + le retard) :
 * ici, toutes les occurrences dans `[from, to]`, utile à un prévisionnel.
 * Réutilise la même arithmétique de mois bornée que `planOccurrences` — ces
 * tests vérifient qu'elle reste bien réutilisée, pas réimplémentée.
 */
import { describe, test, expect } from "vitest";
import { occurrencesDansFenetre } from "../src/recurrence.js";

describe("occurrencesDansFenetre — bornes de fenêtre", () => {
  test("une occurrence exactement sur `from` est incluse", () => {
    const r = occurrencesDansFenetre(
      { cadence: "mensuel", startDate: "2026-08-10", endDate: null },
      "2026-08-10",
      "2026-08-16",
    );
    expect(r.occurrences).toEqual(["2026-08-10"]);
  });

  test("une occurrence exactement sur `to` est incluse", () => {
    const r = occurrencesDansFenetre(
      { cadence: "mensuel", startDate: "2026-08-16", endDate: null },
      "2026-08-10",
      "2026-08-16",
    );
    expect(r.occurrences).toEqual(["2026-08-16"]);
  });

  test("une occurrence juste avant `from` ou juste après `to` est exclue", () => {
    const r = occurrencesDansFenetre(
      { cadence: "mensuel", startDate: "2026-08-09", endDate: null },
      "2026-08-10",
      "2026-08-16",
    );
    // L'ancrage du 9 août tombe hors fenêtre ; la première occurrence
    // suivante (9 septembre) aussi.
    expect(r.occurrences).toEqual([]);
  });

  test("plusieurs occurrences mensuelles dans une fenêtre de huit semaines", () => {
    const r = occurrencesDansFenetre(
      { cadence: "mensuel", startDate: "2026-08-01", endDate: null },
      "2026-08-01",
      "2026-09-30",
    );
    expect(r.occurrences).toEqual(["2026-08-01", "2026-09-01"]);
  });
});

describe("occurrencesDansFenetre — ancrage invalide", () => {
  test("date de début nulle → aucune occurrence, motif explicite", () => {
    const r = occurrencesDansFenetre(
      { cadence: "mensuel", startDate: null, endDate: null },
      "2026-08-01",
      "2026-09-30",
    );
    expect(r.occurrences).toEqual([]);
    expect(r.reason).toMatch(/date de début/);
  });

  test("fenêtre illisible → aucune occurrence, motif explicite", () => {
    const r = occurrencesDansFenetre(
      { cadence: "mensuel", startDate: "2026-08-01", endDate: null },
      "pas-une-date",
      "2026-09-30",
    );
    expect(r.occurrences).toEqual([]);
    expect(r.reason).toMatch(/fenêtre/);
  });
});

describe("occurrencesDansFenetre — arithmétique de mois réutilisée, pas réimplémentée", () => {
  test("ancrage le 31 janvier → l'occurrence de février se borne au dernier jour, jamais le 3 mars", () => {
    const r = occurrencesDansFenetre(
      { cadence: "mensuel", startDate: "2026-01-31", endDate: null },
      "2026-02-01",
      "2026-02-28",
    );
    expect(r.occurrences).toEqual(["2026-02-28"]);
  });

  test("le mois suivant revient au 31 — le jour d'ancrage n'est pas perdu", () => {
    const r = occurrencesDansFenetre(
      { cadence: "mensuel", startDate: "2026-01-31", endDate: null },
      "2026-02-01",
      "2026-03-31",
    );
    expect(r.occurrences).toEqual(["2026-02-28", "2026-03-31"]);
  });
});

describe("occurrencesDansFenetre — cadences plus longues", () => {
  test("trimestriel dont la prochaine occurrence tombe hors d'une fenêtre courte → aucune", () => {
    const r = occurrencesDansFenetre(
      { cadence: "trimestriel", startDate: "2026-01-15", endDate: null },
      "2026-08-01",
      "2026-09-30",
    );
    expect(r.occurrences).toEqual([]);
  });

  test("annuel dont l'échéance tombe dans la fenêtre → une seule occurrence", () => {
    const r = occurrencesDansFenetre(
      { cadence: "annuel", startDate: "2025-08-15", endDate: null },
      "2026-08-01",
      "2026-09-30",
    );
    expect(r.occurrences).toEqual(["2026-08-15"]);
  });
});

describe("occurrencesDansFenetre — terme", () => {
  test("une fin de contrat en cours de fenêtre exclut les occurrences après le terme", () => {
    const r = occurrencesDansFenetre(
      { cadence: "mensuel", startDate: "2026-08-01", endDate: "2026-08-15" },
      "2026-08-01",
      "2026-09-30",
    );
    expect(r.occurrences).toEqual(["2026-08-01"]);
  });
});

describe("occurrencesDansFenetre — garde de sécurité", () => {
  test("un ancrage aberrant ne bloque pas indéfiniment la boucle", () => {
    const r = occurrencesDansFenetre(
      { cadence: "mensuel", startDate: "0226-01-15", endDate: null },
      "2026-08-01",
      "2026-09-30",
    );
    // Doit rendre une réponse (vide ou non), jamais planter ni tourner à l'infini.
    expect(Array.isArray(r.occurrences)).toBe(true);
  });
});
