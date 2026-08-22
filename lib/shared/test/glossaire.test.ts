/**
 * L'accord des comptes en français — ticket 4.29.
 *
 * « "voir les 1 devis" (ce n'est pas correct en français). » Deux fautes dans
 * une phrase de quatre mots : l'article figé, et la marque du pluriel sur un
 * nom qui n'en prend pas.
 */
import { describe, test, expect } from "vitest";
import { accorder, articleEtNom, TERMES_INTERDITS } from "../src/glossaire.js";

describe("a — accorder", () => {
  test.each([
    [0, "semaine"], [1, "semaine"], [2, "semaines"], [10, "semaines"],
  ])("%i → %s", (n, attendu) => {
    // Zéro et un donnent le SINGULIER : c'est la règle française, et elle
    // diffère de l'anglaise où zéro est pluriel.
    expect(accorder(n, "semaine")).toBe(attendu);
  });

  test("un nom invariable ne prend pas de « s »", () => {
    expect(accorder(3, "devis", "devis")).toBe("devis");
  });

  test("un pluriel irrégulier se déclare", () => {
    expect(accorder(2, "travail", "travaux")).toBe("travaux");
  });
});

describe("b — articleEtNom", () => {
  test("au singulier, le compte DISPARAÎT", () => {
    // « Voir le devis » se lit mieux que « Voir le 1 devis », et personne n'a
    // besoin qu'on lui rappelle qu'il y en a un quand il n'y en a qu'un.
    expect(articleEtNom(1, "devis")).toBe("le devis");
  });

  test("au pluriel, le compte est utile", () => {
    expect(articleEtNom(3, "devis")).toBe("les 3 devis");
  });

  test("zéro se lit comme un singulier", () => {
    expect(articleEtNom(0, "facture", "factures", true)).toBe("la facture");
  });

  test("le féminin est porté par l'appelant", () => {
    expect(articleEtNom(1, "facture", "factures", true)).toBe("la facture");
    expect(articleEtNom(4, "facture", "factures", true)).toBe("les 4 factures");
  });

  test("le cas exact du rapport de test", () => {
    expect(`Voir ${articleEtNom(1, "devis")}`).toBe("Voir le devis");
    expect(`Voir ${articleEtNom(1, "devis")}`).not.toContain("les 1");
  });
});

describe("c — la liste des interdits", () => {
  test("les deux termes signalés au test y figurent", () => {
    expect(Object.keys(TERMES_INTERDITS)).toContain("MRR");
    expect(Object.keys(TERMES_INTERDITS)).toContain("YTD");
  });

  test("chaque interdit propose un remplacement en français", () => {
    // Un interdit sans alternative fait juste supprimer l'information.
    for (const [terme, remplacement] of Object.entries(TERMES_INTERDITS)) {
      expect(remplacement.length, `${terme} n'a pas de remplacement`).toBeGreaterThan(3);
      expect(remplacement, `${terme} se remplace par lui-même`).not.toMatch(
        new RegExp(`\\b${terme}\\b`, "i"),
      );
    }
  });
});

describe("d — les invariables, sans que l'appelant y pense", () => {
  test.each([
    ["devis", "les 3 devis"],
    ["prix", "les 3 prix"],
    ["taux", "les 3 taux"],
  ])("« %s » ne prend pas de « s »", (mot, attendu) => {
    // Sans cette règle, il fallait écrire `articleEtNom(n, 'devis', 'devis')`
    // et l'oubli donnait « les 3 deviss ». Je l'ai oublié moi-même sur le
    // premier appel de ce lot — la règle vaut mieux que la vigilance.
    expect(articleEtNom(3, mot)).toBe(attendu);
  });

  test("un nom ordinaire prend toujours son « s »", () => {
    expect(articleEtNom(3, "facture", undefined, true)).toBe("les 3 factures");
  });
});
