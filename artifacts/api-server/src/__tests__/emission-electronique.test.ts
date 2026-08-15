/**
 * Blocage d'émission électronique (US-A2.6) — pure, `today` injecté : la
 * règle du 01/09/2027 est testable sans attendre l'échéance ni truquer
 * l'horloge système.
 */
import { describe, test, expect } from "vitest";
import {
  auditEmissionElectronique,
  OBLIGATION_EMISSION_ELECTRONIQUE_DATE,
} from "../lib/emission-electronique";

// Heures de MILIEU DE JOURNÉE en UTC, volontairement : un "23:59Z" ou
// "00:00Z" traverserait la frontière du jour local sous un fuseau en avance
// sur UTC (Europe/Paris l'été, TZ épinglée par vitest.config.ts) — piège
// déjà découvert en écrivant ce test (voir toDateString, lib/shared).
describe("auditEmissionElectronique — no-op garanti avant l'échéance", () => {
  test("aucun bloquant la veille de l'échéance, PA configurée ou non", () => {
    expect(auditEmissionElectronique(new Date("2027-08-31T12:00:00Z"), false)).toEqual([]);
    expect(auditEmissionElectronique(new Date("2027-08-31T12:00:00Z"), true)).toEqual([]);
  });

  test("aujourd'hui (2026) : jamais de bloquant, quel que soit l'état de la PA", () => {
    expect(auditEmissionElectronique(new Date("2026-08-15T10:00:00Z"), false)).toEqual([]);
  });

  test("des années avant l'échéance : toujours no-op", () => {
    expect(auditEmissionElectronique(new Date("2020-01-01T12:00:00Z"), false)).toEqual([]);
  });
});

describe("auditEmissionElectronique — bloque le jour de l'échéance sans PA configurée", () => {
  test("le jour même, PA absente : un bloquant", () => {
    const issues = auditEmissionElectronique(new Date(`${OBLIGATION_EMISSION_ELECTRONIQUE_DATE}T12:00:00Z`), false);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.bloquant).toBe(true);
    expect(issues[0]!.code).toBe("plateforme_agreee_non_configuree");
  });

  test("le jour même, PA configurée : aucun bloquant", () => {
    const issues = auditEmissionElectronique(new Date(`${OBLIGATION_EMISSION_ELECTRONIQUE_DATE}T12:00:00Z`), true);
    expect(issues).toEqual([]);
  });

  test("longtemps après l'échéance, PA absente : toujours bloquant", () => {
    const issues = auditEmissionElectronique(new Date("2030-01-01T12:00:00Z"), false);
    expect(issues).toHaveLength(1);
  });
});
