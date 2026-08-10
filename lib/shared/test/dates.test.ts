/**
 * Dates métier — bornes de semaine.
 *
 * Ces bornes décident dans quelle semaine tombent des heures pointées, donc
 * quelle marge et quel coût sont imputés. Un décalage d'un jour range le lundi
 * dans la semaine précédente.
 *
 * Le fuseau est épinglé à Europe/Paris par vitest.config.ts, mais ces fonctions
 * doivent être justes dans TOUS les fuseaux — la suite est relancée sous
 * TZ=UTC, Europe/Paris et Pacific/Auckland (voir la PR du lot 1).
 */
import { describe, test, expect } from "vitest";
import { toDateString, bornesSemaine } from "../src/dates.js";

describe("toDateString — composantes locales", () => {
  test("rend le jour local, pas le jour UTC", () => {
    // 1er septembre 2026 à 00 h 30 LOCAL. En Europe/Paris (UTC+2 en été),
    // toISOString() donnerait 2026-08-31T22:30Z, donc "2026-08-31" si on
    // tranchait la chaîne ISO. La date métier est bien le 1er septembre.
    const d = new Date(2026, 8, 1, 0, 30, 0);
    expect(toDateString(d)).toBe("2026-09-01");
  });

  test("zéros de tête sur le mois et le jour", () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("bornesSemaine — lundi au dimanche", () => {
  test("un mercredi rend le lundi et le dimanche qui l'encadrent", () => {
    // Mercredi 12 août 2026 → lundi 10, dimanche 16.
    expect(bornesSemaine(new Date(2026, 7, 12))).toEqual({
      debut: "2026-08-10",
      fin: "2026-08-16",
    });
  });

  test("le lundi est sa propre borne de début", () => {
    expect(bornesSemaine(new Date(2026, 7, 10))).toEqual({
      debut: "2026-08-10",
      fin: "2026-08-16",
    });
  });

  test("le DIMANCHE appartient à la semaine qui s'achève, pas à la suivante", () => {
    // Le piège classique : getDay() vaut 0 le dimanche, et un simple
    // « 1 - jour » le renverrait au lundi SUIVANT.
    expect(bornesSemaine(new Date(2026, 7, 16))).toEqual({
      debut: "2026-08-10",
      fin: "2026-08-16",
    });
  });

  test("une semaine à cheval sur deux mois", () => {
    // Mardi 1er septembre 2026 → lundi 31 août, dimanche 6 septembre.
    expect(bornesSemaine(new Date(2026, 8, 1))).toEqual({
      debut: "2026-08-31",
      fin: "2026-09-06",
    });
  });

  test("une semaine à cheval sur deux années", () => {
    // Vendredi 1er janvier 2027 → lundi 28 décembre 2026, dimanche 3 janvier.
    expect(bornesSemaine(new Date(2027, 0, 1))).toEqual({
      debut: "2026-12-28",
      fin: "2027-01-03",
    });
  });

  test("les bornes couvrent toujours exactement sept jours", () => {
    for (let i = 0; i < 14; i++) {
      const d = new Date(2026, 7, 1 + i);
      const { debut, fin } = bornesSemaine(d);
      const ecartJours =
        (new Date(`${fin}T00:00:00Z`).getTime() - new Date(`${debut}T00:00:00Z`).getTime()) /
        86_400_000;
      expect(ecartJours).toBe(6);
      // Et le jour testé est bien dans l'intervalle.
      expect(toDateString(d) >= debut).toBe(true);
      expect(toDateString(d) <= fin).toBe(true);
    }
  });

  test("juste après minuit, la semaine ne bascule pas", () => {
    // Lundi 10 août 2026 à 00 h 15 local — le moment où une conversion UTC
    // ferait basculer dans la semaine précédente.
    expect(bornesSemaine(new Date(2026, 7, 10, 0, 15)).debut).toBe("2026-08-10");
  });
});
