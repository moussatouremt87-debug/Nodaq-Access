/**
 * Qualification à l'inscription — ticket 4.36, lot A.
 *
 * « Un onboarding qui ne configure rien est un questionnaire marketing, pas un
 * onboarding. » Ces tests portent sur ce que les réponses PRODUISENT.
 */
import { describe, test, expect } from "vitest";
import {
  peutEmettreDocumentLegal, messageSirenManquant, premiereAction,
  PROFIL_VIDE, STADES_ENTREPRISE,
} from "../src/qualificationOnboarding.js";

describe("a — les trois stades répondent OUI à l'inscription", () => {
  test("les trois existent, y compris « en projet »", () => {
    // Exiger un SIREN pour essayer un logiciel, c'est perdre exactement les
    // gens qui en ont le plus besoin, au moment où ils choisissent leurs
    // outils.
    expect(STADES_ENTREPRISE).toContain("EN_IMMATRICULATION");
    expect(STADES_ENTREPRISE).toContain("EN_PROJET");
  });
});

describe("b — ce que le SIREN débloque, c'est l'ÉMISSION", () => {
  test.each(STADES_ENTREPRISE)("sans SIRET, « %s » ne peut pas émettre", (stade) => {
    // Le stade ne change pas la loi : la mention est obligatoire quel que soit
    // l'endroit où l'on en est.
    expect(peutEmettreDocumentLegal({ stade }, false)).toBe(false);
  });

  test.each(STADES_ENTREPRISE)("avec un SIRET, « %s » émet", (stade) => {
    expect(peutEmettreDocumentLegal({ stade }, true)).toBe(true);
  });
});

describe("c — le message explique, il ne reproche pas", () => {
  test("en cours d'immatriculation : on dit ce qui est possible AVANT ce qui manque", () => {
    const m = messageSirenManquant("EN_IMMATRICULATION");
    expect(m).toContain("Vous pouvez tout préparer");
    expect(m).toContain("se débloquera");
    expect(m.toLowerCase()).not.toMatch(/impossible|interdit|vous devez/);
  });

  test("en projet : même esprit", () => {
    expect(messageSirenManquant("EN_PROJET")).toContain("tout préparer");
  });

  test("entreprise existante : on nomme le champ et où le saisir", () => {
    // Quelqu'un dont l'entreprise existe a le numéro sous la main : ce qu'il
    // lui faut, c'est savoir OÙ le mettre.
    const m = messageSirenManquant("EXISTANTE");
    expect(m).toContain("Profil entreprise");
  });

  test("stade non renseigné : le message reste utile", () => {
    expect(messageSirenManquant(null)).toContain("mention obligatoire");
  });
});

describe("d — la première action dépend de l'irritant", () => {
  test.each([
    ["IMPAYES", "/factures"],
    ["RELANCES", "/factures"],
    ["TRESORERIE", "/reprise"],
    ["PAPERASSE", "/chat"],
  ] as const)("« %s » mène à %s", (irritant, chemin) => {
    expect(premiereAction({ ...PROFIL_VIDE, irritant }).chemin).toBe(chemin);
  });

  test("sans réponse, on propose le devis dicté", () => {
    // Le défaut est la promesse centrale du produit, et la démonstration la
    // plus courte de ce qu'il sait faire.
    expect(premiereAction(PROFIL_VIDE).cle).toBe("devis_dicte");
  });

  test("il y a TOUJOURS une action — jamais un cockpit vide", () => {
    // « L'onboarding se termine par UNE action concrète, pas par un cockpit
    // vide » : un tableau de bord sans données ne montre rien et n'apprend
    // rien à quelqu'un qui vient de s'inscrire.
    for (const irritant of [null, "AUTRE"] as const) {
      const a = premiereAction({ ...PROFIL_VIDE, irritant });
      expect(a.chemin).toBeTruthy();
      expect(a.titre.length).toBeGreaterThan(10);
    }
  });
});
