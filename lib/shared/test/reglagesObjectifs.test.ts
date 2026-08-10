/**
 * Bornes des réglages d'objectif — une par valeur refusée.
 *
 * Le défaut : `35` écrit au lieu de `3500` a produit un seuil de rentabilité
 * de 13 714 286 €, affiché sans le moindre avertissement. Le calcul était
 * juste ; c'est l'entrée qui était absurde, et rien ne l'a refusée.
 */
import { describe, test, expect } from "vitest";
import {
  verifierReglageObjectif,
  verifierReglagesObjectifs,
  CLE_TAUX_MARGE,
  CLE_CHARGES_FIXES,
  TAUX_MARGE_BP_MIN,
  TAUX_MARGE_BP_MAX,
  CHARGES_FIXES_CENTS_MIN,
  CHARGES_FIXES_CENTS_MAX,
} from "../src/reglagesObjectifs.js";

describe("l'unité est dans le nom", () => {
  test("les clés portent leur unité", () => {
    // Le nom est la première défense : `objectifs.taux_marge` ne disait pas
    // qu'il attendait des points de base.
    expect(CLE_TAUX_MARGE).toMatch(/_bp$/);
    expect(CLE_CHARGES_FIXES).toMatch(/_cents$/);
  });
});

describe("taux de marge — de 1 % à 100 %", () => {
  test("LE CAS OBSERVÉ : 35 au lieu de 3500 est refusé", () => {
    const r = verifierReglageObjectif(CLE_TAUX_MARGE, "35");
    expect(r).not.toBeNull();
    // Le message doit dire QUOI écrire, pas seulement que c'est faux.
    expect(r!.message).toContain("3500");
  });

  test.each([
    ["zéro", "0"],
    ["négatif", "-500"],
    ["juste sous la borne", String(TAUX_MARGE_BP_MIN - 1)],
    ["juste au-dessus", String(TAUX_MARGE_BP_MAX + 1)],
    ["au-delà de 100 %", "15000"],
    ["décimal", "3500.5"],
    ["texte", "trente-cinq"],
    ["vide", ""],
  ])("%s → refusé", (_label, valeur) => {
    expect(verifierReglageObjectif(CLE_TAUX_MARGE, valeur)).not.toBeNull();
  });

  test.each([
    ["1 %", String(TAUX_MARGE_BP_MIN)],
    ["35 %", "3500"],
    ["100 %", String(TAUX_MARGE_BP_MAX)],
  ])("%s → accepté", (_label, valeur) => {
    expect(verifierReglageObjectif(CLE_TAUX_MARGE, valeur)).toBeNull();
  });
});

describe("charges fixes annuelles — fourchette d'une TPE", () => {
  test.each([
    ["zéro", "0"],
    ["négatif", "-100000"],
    ["juste sous la borne", String(CHARGES_FIXES_CENTS_MIN - 1)],
    ["juste au-dessus", String(CHARGES_FIXES_CENTS_MAX + 1)],
    ["centimes pris pour des euros — 120 000 € saisis en euros", "120000000000"],
    ["décimal", "12000000.5"],
    ["texte", "beaucoup"],
  ])("%s → refusé", (_label, valeur) => {
    expect(verifierReglageObjectif(CLE_CHARGES_FIXES, valeur)).not.toBeNull();
  });

  test.each([
    ["1 000 €", String(CHARGES_FIXES_CENTS_MIN)],
    ["120 000 €", "12000000"],
    ["2 000 000 €", String(CHARGES_FIXES_CENTS_MAX)],
  ])("%s → accepté", (_label, valeur) => {
    expect(verifierReglageObjectif(CLE_CHARGES_FIXES, valeur)).toBeNull();
  });
});

describe("ce que les bornes N'ATTRAPENT PAS — limite assumée", () => {
  test("une confusion d'unité qui reste dans la fourchette passe", () => {
    // 120000 centimes = 1 200 €. Quelqu'un qui voulait dire « 120 000 € » et a
    // tapé la valeur en euros obtient une charge cent fois trop faible — et
    // 1 200 € par an reste PLAUSIBLE pour une très petite structure, donc la
    // borne ne peut pas le refuser sans refuser aussi des cas légitimes.
    //
    // Les bornes attrapent les absurdités d'ordre de grandeur aux extrémités,
    // pas toutes les confusions du milieu. C'est écrit ici pour que personne
    // ne croie la garde plus forte qu'elle n'est.
    expect(verifierReglageObjectif(CLE_CHARGES_FIXES, "120000")).toBeNull();
  });
});

describe("les autres réglages ne sont pas jugés", () => {
  test("une clé inconnue passe sans avis", () => {
    // Cette fonction ne se prononce QUE sur les réglages d'objectif.
    expect(verifierReglageObjectif("metier.siret", "n'importe quoi")).toBeNull();
  });

  test("un lot rend TOUS les refus, pas seulement le premier", () => {
    const refus = verifierReglagesObjectifs({
      [CLE_TAUX_MARGE]: "35",
      [CLE_CHARGES_FIXES]: "1",
      "metier.siret": "12345678901234",
    });
    expect(refus).toHaveLength(2);
    expect(refus.map((r) => r.cle).sort()).toEqual([CLE_CHARGES_FIXES, CLE_TAUX_MARGE].sort());
  });
});
