/**
 * Spec 4.11 §6 — Comparability guard
 *
 * "TOUJOURS À DATE COMPARABLE. Comparer 7 mois de 2026 à l'année 2025 entière est faux.
 *  Les deux bornes doivent avoir la même longueur, et l'écran affiche les deux plages
 *  en clair."
 *
 * "Écris un test qui échoue si deux bornes de longueurs différentes sont acceptées."
 *
 * This test MUST FAIL if assertDurationEqual ever allows unequal ranges through.
 */

import { describe, it, expect } from "vitest";
import {
  parsePeriode,
  assertDurationEqual,
  memePeriodeN1,
  periodePrecedente,
  getLast12Months,
  messageImpossible,
  type PeriodeBorne,
} from "../lib/analytics-periods.js";

const TODAY = new Date("2026-08-07T12:00:00Z");

// ── Period parsing ────────────────────────────────────────────────────────────

describe("parsePeriode", () => {
  it("mois → 1er–31 août 2026", () => {
    const p = parsePeriode("mois", undefined, undefined, TODAY);
    expect(p.debut.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(p.fin.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(p.label).toContain("août");
  });

  it("trimestre → T3 2026 (juillet–septembre)", () => {
    const p = parsePeriode("trimestre", undefined, undefined, TODAY);
    expect(p.debut.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(p.fin.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(p.label).toBe("T3 2026");
  });

  it("exercice → 1er jan–31 déc 2026", () => {
    const p = parsePeriode("exercice", undefined, undefined, TODAY);
    expect(p.debut.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(p.fin.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("12_mois → 365 jours glissants se terminant aujourd'hui", () => {
    const p = parsePeriode("12_mois", undefined, undefined, TODAY);
    expect(p.fin.toISOString().slice(0, 10)).toBe("2026-08-07");
    expect(p.debut.toISOString().slice(0, 10)).toBe("2025-08-08");
  });

  it("période libre → bornes respectées", () => {
    const p = parsePeriode(undefined, "2026-03-01", "2026-03-31", TODAY);
    expect(p.debut.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(p.fin.toISOString().slice(0, 10)).toBe("2026-03-31");
  });
});

// ── Comparison helpers ────────────────────────────────────────────────────────

describe("memePeriodeN1", () => {
  it("décale d'un an les deux bornes", () => {
    const mois = parsePeriode("mois", undefined, undefined, TODAY);
    const n1 = memePeriodeN1(mois);
    expect(n1.debut.toISOString().slice(0, 10)).toBe("2025-08-01");
    expect(n1.fin.toISOString().slice(0, 10)).toBe("2025-08-31");
  });
});

describe("periodePrecedente", () => {
  it("retourne la période de même durée juste avant", () => {
    const mois = parsePeriode("mois", undefined, undefined, TODAY);
    const prec = periodePrecedente(mois);
    // Août dure 31 jours → période précédente dure aussi 31 jours
    const durationDays = Math.round(
      (prec.fin.getTime() - prec.debut.getTime()) / 86400000,
    );
    const moisDays = Math.round(
      (mois.fin.getTime() - mois.debut.getTime()) / 86400000,
    );
    expect(durationDays).toBe(moisDays);
    // Fin de la période précédente = veille du début du mois courant
    expect(prec.fin.getTime()).toBeLessThan(mois.debut.getTime());
  });
});

describe("getLast12Months", () => {
  it("retourne 12 mois ordonnés du plus ancien au plus récent", () => {
    const months = getLast12Months(TODAY);
    expect(months).toHaveLength(12);
    expect(months[0]!.debut.toISOString().slice(0, 7)).toBe("2025-09");
    expect(months[11]!.debut.toISOString().slice(0, 7)).toBe("2026-08");
    // Strictly ordered
    for (let i = 1; i < months.length; i++) {
      expect(months[i]!.debut.getTime()).toBeGreaterThan(months[i - 1]!.debut.getTime());
    }
  });

  it("chaque mois a fin >= debut", () => {
    getLast12Months(TODAY).forEach((m) => {
      expect(m.fin.getTime()).toBeGreaterThanOrEqual(m.debut.getTime());
    });
  });
});

// ── assertDurationEqual — the critical spec §6 guard ─────────────────────────
//
// THESE TESTS MUST FAIL if assertDurationEqual allows unequal ranges through.

describe("assertDurationEqual", () => {
  it("✓ accepte deux mois calendaires identiques (Y et Y-1)", () => {
    const mois = parsePeriode("mois", undefined, undefined, TODAY);
    const n1 = memePeriodeN1(mois);
    // Must NOT throw
    expect(() => assertDurationEqual(mois, n1)).not.toThrow();
  });

  it("✓ accepte deux trimestres identiques (Y et Y-1)", () => {
    const t = parsePeriode("trimestre", undefined, undefined, TODAY);
    const n1 = memePeriodeN1(t);
    expect(() => assertDurationEqual(t, n1)).not.toThrow();
  });

  it("✓ accepte deux périodes 12-mois glissants de même durée", () => {
    const r = parsePeriode("12_mois", undefined, undefined, TODAY);
    const prec = periodePrecedente(r);
    expect(() => assertDurationEqual(r, prec)).not.toThrow();
  });

  // ── Rejections — comparing unequal lengths MUST throw ──────────────────────

  it("✗ REJETTE : exercice (365 j) vs mois (31 j)", () => {
    const ex = parsePeriode("exercice", undefined, undefined, TODAY);
    const mois = parsePeriode("mois", undefined, undefined, TODAY);
    expect(() => assertDurationEqual(ex, mois)).toThrow(/incomparables/i);
  });

  it("✗ REJETTE : 7 mois de 2026 (YTD) vs l'année 2025 entière", () => {
    // The canonical bug the spec was written to prevent (§6)
    const ytd: PeriodeBorne = {
      debut: new Date("2026-01-01"),
      fin: new Date("2026-08-07T23:59:59"),
      label: "1er janvier au 7 août 2026",
    };
    const fullYear2025: PeriodeBorne = {
      debut: new Date("2025-01-01"),
      fin: new Date("2025-12-31T23:59:59"),
      label: "exercice 2025",
    };
    expect(() => assertDurationEqual(ytd, fullYear2025)).toThrow(/incomparables/i);
  });

  it("✗ REJETTE : trimestre (92 j) vs 12 mois glissants (365 j)", () => {
    const t = parsePeriode("trimestre", undefined, undefined, TODAY);
    const r = parsePeriode("12_mois", undefined, undefined, TODAY);
    expect(() => assertDurationEqual(t, r)).toThrow(/incomparables/i);
  });

  it("✗ REJETTE : période libre 3 jours vs période libre 30 jours", () => {
    const courte: PeriodeBorne = {
      debut: new Date("2026-08-01"),
      fin: new Date("2026-08-03T23:59:59"),
      label: "1–3 août",
    };
    const longue: PeriodeBorne = {
      debut: new Date("2026-07-01"),
      fin: new Date("2026-07-30T23:59:59"),
      label: "juillet",
    };
    expect(() => assertDurationEqual(courte, longue)).toThrow(/incomparables/i);
  });

  it("✗ REJETTE : mois vs période précédente d'un exercice (durées différentes)", () => {
    const mois = parsePeriode("mois", undefined, undefined, TODAY);
    const ex = parsePeriode("exercice", undefined, undefined, new Date("2025-12-31"));
    // mois ≈ 31 j, exercice ≈ 365 j → must reject
    expect(() => assertDurationEqual(mois, ex)).toThrow(/incomparables/i);
  });
});

// ── messageImpossible — must return a sentence, never empty / dash ────────────

describe("messageImpossible", () => {
  const mois = parsePeriode("mois", undefined, undefined, TODAY);

  it("meme_periode_n1 → mentionne le mois où la comparaison sera disponible", () => {
    const msg = messageImpossible("meme_periode_n1", mois, TODAY);
    expect(msg).toMatch(/août 2027/i);
    expect(msg.length).toBeGreaterThan(20);
  });

  it("periode_precedente → phrase non vide", () => {
    const msg = messageImpossible("periode_precedente", mois, TODAY);
    expect(msg.length).toBeGreaterThan(10);
    expect(msg).not.toBe("-");
  });

  it("moyenne_12_mois → mentionne le nombre de mois requis", () => {
    const msg = messageImpossible("moyenne_12_mois", mois, TODAY);
    expect(msg).toMatch(/3\s*mois/i);
  });
});
