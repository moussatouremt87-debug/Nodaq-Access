/**
 * Blocage d'émission électronique (US-A2.6) — pure, `today` injecté : la
 * règle du 01/09/2027 est testable sans attendre l'échéance ni truquer
 * l'horloge système.
 *
 * ── Pourquoi ce fichier ne construit AUCUNE date depuis un instant UTC ────
 * `auditEmissionElectronique` compare une DATE MÉTIER : le jour calendaire
 * de l'artisan, lu par `toDateString` sur les composantes LOCALES. Lui
 * passer `new Date("2027-08-31T12:00:00Z")` revient à décrire ce jour par un
 * instant, et un instant ne désigne pas le même jour partout.
 *
 * La version précédente le faisait, avec un commentaire qui justifiait midi
 * UTC comme une marge suffisante « sous un fuseau en avance sur UTC
 * (Europe/Paris l'été) ». Le raisonnement tient pour +02:00 ; il tombe à
 * +12:00, où midi UTC le 31 août EST le 1er septembre à minuit — soit
 * exactement l'échéance que le test prétendait ne pas avoir atteinte. Le
 * segment `TZ=Pacific/Auckland` de la CI l'a signalé, sur ce test précis, à
 * chaque exécution.
 *
 * Le code de production n'était pas en cause : il bloquait à juste titre.
 * C'était la prémisse du test qui était fausse.
 *
 * D'où `jourLocal` : un jour calendaire se construit par ses composantes
 * locales, jamais par un instant. Même doctrine que `toDateString`
 * (lib/shared) et que la garde `period-bounds-timezone-guard.test.ts` — qui
 * ne pouvait pas attraper ce cas-ci : elle interdit `toISOString()` en
 * SORTIE, et ignore les fichiers de test.
 */
import { describe, test, expect } from "vitest";
import { toDateString } from "@nodaq/shared";
import {
  auditEmissionElectronique,
  OBLIGATION_EMISSION_ELECTRONIQUE_DATE,
} from "../lib/emission-electronique";

/**
 * Midi du jour calendaire `aaaa-mm-jj` DANS LE FUSEAU COURANT — donc le même
 * jour métier quel que soit le fuseau où tourne la suite.
 */
function jourLocal(iso: string): Date {
  const [a, m, j] = iso.split("-").map(Number);
  return new Date(a!, m! - 1, j!, 12, 0, 0);
}

describe("jourLocal — la prémisse des tests qui suivent", () => {
  test("le jour rendu est celui demandé, sous n'importe quel fuseau", () => {
    // Sans cette vérification, une erreur de construction rendrait tous les
    // tests de ce fichier verts pour la mauvaise raison — ce qui vient
    // précisément d'arriver.
    for (const iso of ["2020-01-01", "2026-08-15", "2027-08-31", "2027-09-01", "2030-01-01"]) {
      expect(toDateString(jourLocal(iso)), `fuseau courant : ${process.env["TZ"]}`).toBe(iso);
    }
  });
});

describe("auditEmissionElectronique — no-op garanti avant l'échéance", () => {
  test("aucun bloquant la veille de l'échéance, PA configurée ou non", () => {
    expect(auditEmissionElectronique(jourLocal("2027-08-31"), false)).toEqual([]);
    expect(auditEmissionElectronique(jourLocal("2027-08-31"), true)).toEqual([]);
  });

  test("aujourd'hui (2026) : jamais de bloquant, quel que soit l'état de la PA", () => {
    expect(auditEmissionElectronique(jourLocal("2026-08-15"), false)).toEqual([]);
  });

  test("des années avant l'échéance : toujours no-op", () => {
    expect(auditEmissionElectronique(jourLocal("2020-01-01"), false)).toEqual([]);
  });
});

describe("auditEmissionElectronique — bloque le jour de l'échéance sans PA configurée", () => {
  test("le jour même, PA absente : un bloquant", () => {
    const issues = auditEmissionElectronique(
      jourLocal(OBLIGATION_EMISSION_ELECTRONIQUE_DATE),
      false,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.bloquant).toBe(true);
    expect(issues[0]!.code).toBe("plateforme_agreee_non_configuree");
  });

  test("le jour même, PA configurée : aucun bloquant", () => {
    const issues = auditEmissionElectronique(
      jourLocal(OBLIGATION_EMISSION_ELECTRONIQUE_DATE),
      true,
    );
    expect(issues).toEqual([]);
  });

  test("longtemps après l'échéance, PA absente : toujours bloquant", () => {
    const issues = auditEmissionElectronique(jourLocal("2030-01-01"), false);
    expect(issues).toHaveLength(1);
  });
});
