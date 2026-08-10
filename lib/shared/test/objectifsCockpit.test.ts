/**
 * Objectifs du cockpit — cas posés à la main.
 *
 * Ce que ces tests protègent :
 *   — un seuil de rentabilité n'est JAMAIS inventé, ni rendu à zéro ;
 *   — la médiane, et non la moyenne, décrit le chantier ordinaire ;
 *   — la borne « même jour l'an dernier » ne produit pas de date inexistante ;
 *   — « loin » n'est jamais confondu avec « à portée » faute de données.
 */
import { describe, test, expect } from "vitest";
import {
  mediane,
  calculerSeuilRentabilite,
  convertirEnChantiers,
  choisirTon,
  memeJourExercicePrecedent,
  debutExercice,
  debutExercicePrecedent,
  joursRestantsExercice,
  MIN_AFFAIRES_POUR_CONVERSION,
} from "../src/objectifsCockpit.js";

describe("bornes d'exercice", () => {
  test("début et exercice précédent, en composantes locales", () => {
    const jour = new Date(2026, 7, 10);
    expect(debutExercice(jour)).toBe("2026-01-01");
    expect(debutExercicePrecedent(jour)).toBe("2025-01-01");
  });

  test("le 1er janvier à 00 h 30 reste dans SON exercice", () => {
    // Une borne dérivée d'un toISOString basculerait sur l'année précédente en
    // Europe/Paris, et l'écart annoncé porterait sur la mauvaise année.
    expect(debutExercice(new Date(2026, 0, 1, 0, 30))).toBe("2026-01-01");
  });
});

describe("borne « même jour l'an dernier » — le piège du 29 février", () => {
  test("un 29 février est ramené au 28 quand l'an dernier n'est pas bissextile", () => {
    // 2028 est bissextile, 2027 ne l'est pas. Le recollage de composantes
    // produisait « 2027-02-29 », une date inexistante qui fait échouer la
    // requête. new Date(2027, 1, 29) ne vaut pas mieux : il déborde au 1er mars
    // et compte un jour de trop.
    expect(memeJourExercicePrecedent(new Date(2028, 1, 29))).toBe("2027-02-28");
  });

  test("un 29 février reste au 29 quand l'an dernier EST bissextile", () => {
    // 2025 → 2024, bissextile.
    expect(memeJourExercicePrecedent(new Date(2025, 1, 28))).toBe("2024-02-28");
    // Et un 1er mars 2025 → 1er mars 2024, sans décalage.
    expect(memeJourExercicePrecedent(new Date(2025, 2, 1))).toBe("2024-03-01");
  });

  test("les 31 sont ramenés au dernier jour du mois visé", () => {
    // 31 mars → 31 mars : le mois a 31 jours, rien à ramener.
    expect(memeJourExercicePrecedent(new Date(2026, 2, 31))).toBe("2025-03-31");
  });

  test("la borne produite est toujours une date RÉELLE", () => {
    for (let i = 0; i < 366; i++) {
      const jour = new Date(2028, 0, 1 + i); // 2028 est bissextile
      const borne = memeJourExercicePrecedent(jour);
      const analysee = new Date(`${borne}T00:00:00Z`);
      expect(Number.isNaN(analysee.getTime()), `borne invalide : ${borne}`).toBe(false);
      // Et la date analysée correspond bien à ce qui est écrit — pas de
      // débordement silencieux au mois suivant.
      expect(analysee.toISOString().slice(0, 10)).toBe(borne);
    }
  });
});

describe("médiane, pas moyenne", () => {
  test("série impaire", () => {
    expect(mediane([3, 1, 2])).toBe(2);
  });

  test("série paire — moyenne des deux du milieu", () => {
    expect(mediane([1, 2, 3, 4])).toBe(2.5);
  });

  test("série vide → null, jamais 0", () => {
    expect(mediane([])).toBeNull();
  });

  test("un chantier exceptionnel ne déforme pas la médiane", () => {
    // Quatre dépannages à 1 000 € et une toiture d'immeuble à 200 000 €.
    // Moyenne = 40 800 € — un chantier « ordinaire » qui n'existe pas.
    // Médiane = 1 000 €, qui décrit l'activité réelle.
    const serie = [1000, 1000, 1000, 1000, 200_000];
    expect(mediane(serie)).toBe(1000);
    const moyenne = serie.reduce((a, b) => a + b, 0) / serie.length;
    expect(moyenne).toBeGreaterThan(40_000);
  });
});

describe("seuil de rentabilité — jamais inventé, jamais zéro", () => {
  test("cas posé à la main : 120 000 € de charges, 35 % de marge → 342 857,14 €", () => {
    // 12 000 000 c ÷ 0,35 = 34 285 714,28… → arrondi 34 285 714 c.
    const r = calculerSeuilRentabilite({
      chargesFixesAnnuellesCents: 12_000_000,
      tauxMargeBps: 3500,
    });
    expect(r).not.toBeNull();
    expect(r!.seuilCents).toBe(34_285_714);
    expect(r!.provenance).toBe("saisie");
  });

  test.each([
    ["charges absentes", null, 3500],
    ["taux absent", 12_000_000, null],
    ["charges nulles", 0, 3500],
    ["charges négatives", -100, 3500],
    ["taux nul", 12_000_000, 0],
    ["taux négatif", 12_000_000, -500],
    ["taux au-delà de 100 %", 12_000_000, 15_000],
  ])("%s → null, et surtout PAS zéro", (_label, charges, taux) => {
    const r = calculerSeuilRentabilite({
      chargesFixesAnnuellesCents: charges as number | null,
      tauxMargeBps: taux as number | null,
    });
    // Un seuil à zéro s'afficherait comme un objectif déjà atteint.
    expect(r).toBeNull();
  });
});

describe("conversion d'un écart en chantiers", () => {
  const cinqAffaires = [
    { montantCents: 500_000, dureeJours: 10 },
    { montantCents: 400_000, dureeJours: 8 },
    { montantCents: 600_000, dureeJours: 12 },
    { montantCents: 300_000, dureeJours: 6 },
    { montantCents: 700_000, dureeJours: 14 },
  ];

  test("cinq affaires suffisent — médiane 500 000 c, écart 1 200 000 c → 3 chantiers", () => {
    // 1 200 000 ÷ 500 000 = 2,4 → 3 chantiers (on arrondit au supérieur : deux
    // chantiers et demi ne se vendent pas).
    const c = convertirEnChantiers(1_200_000, cinqAffaires);
    expect(c).not.toBeNull();
    expect(c!.montantMedianCents).toBe(500_000);
    expect(c!.dureeMedianeJours).toBe(10);
    expect(c!.nbChantiers).toBe(3);
  });

  test("QUATRE affaires ne suffisent pas — aucune conversion", () => {
    expect(convertirEnChantiers(1_200_000, cinqAffaires.slice(0, 4))).toBeNull();
    expect(MIN_AFFAIRES_POUR_CONVERSION).toBe(5);
  });

  test("un écart nul ou négatif ne se convertit pas", () => {
    expect(convertirEnChantiers(0, cinqAffaires)).toBeNull();
    expect(convertirEnChantiers(-1000, cinqAffaires)).toBeNull();
  });
});

describe("registre du texte", () => {
  const conversion = {
    nbChantiers: 3,
    montantMedianCents: 500_000,
    dureeMedianeJours: 10,
    nbAffairesObservees: 5,
  };

  test("écart nul ou dépassé → atteint", () => {
    expect(choisirTon(0, conversion, 100)).toBe("atteint");
    expect(choisirTon(-50_000, conversion, 100)).toBe("atteint");
  });

  test("3 chantiers de 10 jours dans 100 jours restants → à portée", () => {
    expect(choisirTon(1_200_000, conversion, 100)).toBe("a_portee");
  });

  test("3 chantiers de 10 jours dans 20 jours restants → loin", () => {
    // Deux chantiers tiennent, pas trois.
    expect(choisirTon(1_200_000, conversion, 20)).toBe("loin");
  });

  test("SANS conversion possible, on ne suppose pas « à portée »", () => {
    // Moins de cinq affaires : on ne peut rien affirmer sur la faisabilité.
    // Dire « à portée » sans base serait un encouragement gratuit.
    expect(choisirTon(1_200_000, null, 300)).toBe("loin");
  });
});

describe("jours restants dans l'exercice", () => {
  test("au 31 décembre, il n'en reste aucun", () => {
    expect(joursRestantsExercice(new Date(2026, 11, 31))).toBe(0);
  });

  test("au 1er janvier d'une année non bissextile, il en reste 364", () => {
    expect(joursRestantsExercice(new Date(2026, 0, 1))).toBe(364);
  });

  test("une année bissextile en compte un de plus", () => {
    expect(joursRestantsExercice(new Date(2028, 0, 1))).toBe(365);
  });
});
