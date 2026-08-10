/**
 * Coût de la main-d'œuvre — conversions et ordre de résolution.
 *
 * Chaque attendu est posé à la main dans le commentaire qui le précède : ces
 * nombres finissent multipliés par des heures pointées et affichés comme une
 * marge, une erreur de conversion se voit au bilan et pas avant.
 */
import { describe, test, expect } from "vitest";
import {
  coutJourDepuisMensuel,
  resoudreCoutHoraireMembreCents,
  HEURES_PAR_JOUR_STANDARD,
  SEMAINES_PAR_MOIS,
} from "../src/coutMainOeuvre.js";

describe("coutJourDepuisMensuel", () => {
  test("3 000 €/mois sur 5 jours/semaine → 138,46 €/jour", () => {
    // Posé à la main : 5 × 52/12 = 21,6667 jours par mois.
    //                  3 000 / 21,6667 = 138,4615… €
    const r = coutJourDepuisMensuel(3000, 5);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(138.4615, 3);
  });

  test("un temps partiel coûte plus cher à la journée", () => {
    // 3 000 € sur 3 jours/semaine = 13 jours par mois → 230,77 €/jour.
    const r = coutJourDepuisMensuel(3000, 3);
    expect(r!).toBeCloseTo(230.769, 2);
  });

  test("52/12 et non 4 semaines — l'écart est réel", () => {
    // Avec 4 semaines : 3 000 / 20 = 150 €. Avec 52/12 : 138,46 €.
    // Retenir 4 surestimerait le coût jour de 8 %, donc les coûts de chantier.
    expect(SEMAINES_PAR_MOIS).toBeCloseTo(4.3333, 3);
    expect(coutJourDepuisMensuel(3000, 5)!).toBeLessThan(150);
  });

  test.each([
    ["coût mensuel absent", null, 5],
    ["coût mensuel nul", 0, 5],
    ["coût mensuel négatif", -100, 5],
    ["jours par semaine absents", 3000, null],
    ["jours par semaine nuls", 3000, 0],
  ])("%s → null, jamais un chiffre inventé", (_label, cout, jours) => {
    expect(coutJourDepuisMensuel(cout as number | null, jours as number | null)).toBeNull();
  });
});

describe("resoudreCoutHoraireMembreCents — ordre de résolution", () => {
  test("1. le coût mensuel du membre l'emporte sur le réglage d'équipe", () => {
    // 3 000 €/mois, 5 j/sem → 138,4615 €/jour → /7 = 19,7802 €/h → 1 978 c.
    // Le réglage d'équipe (250 €/jour) ne doit PAS être utilisé.
    const r = resoudreCoutHoraireMembreCents({
      coutMensuelChargeEuros: 3000,
      joursParSemaine: 5,
      coutJourChargeEquipeEuros: 250,
    });
    expect(r).toBe(1978);
  });

  test("2. à défaut, le coût jour d'équipe", () => {
    // 250 €/jour ÷ 7 h = 35,7142 €/h → 3 571 c.
    const r = resoudreCoutHoraireMembreCents({
      coutMensuelChargeEuros: null,
      joursParSemaine: 5,
      coutJourChargeEquipeEuros: 250,
    });
    expect(r).toBe(3571);
  });

  test("3. à défaut, INCONNU — jamais zéro, jamais une valeur par défaut", () => {
    const r = resoudreCoutHoraireMembreCents({
      coutMensuelChargeEuros: null,
      joursParSemaine: 5,
      coutJourChargeEquipeEuros: null,
    });
    expect(r).toBeNull();
    expect(r).not.toBe(0);
  });

  test("un réglage d'équipe à 0 vaut « non renseigné », pas « gratuit »", () => {
    const r = resoudreCoutHoraireMembreCents({
      coutMensuelChargeEuros: null,
      joursParSemaine: 5,
      coutJourChargeEquipeEuros: 0,
    });
    expect(r).toBeNull();
  });

  test("la journée standard reste 7 h", () => {
    expect(HEURES_PAR_JOUR_STANDARD).toBe(7);
  });
});
