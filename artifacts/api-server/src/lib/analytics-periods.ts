/**
 * Period utilities for the analytics engine.
 *
 * Rules (spec 4.11 §4-7):
 *  - Default comparison = SAME PERIOD LAST YEAR, not previous period.
 *    Reason: in building/construction, comparing August to July always shows a
 *    collapse (summer holidays) — users would wrongly conclude things are going badly.
 *  - If Y-1 data does not yet exist, the engine signals `messageImpossible` with
 *    a plain-French sentence. Never a dash or a zero.
 *  - Two ranges being compared MUST have the same duration (±24 h). The engine
 *    enforces this at runtime AND there is a vitest test that fails if it does not.
 */

export type PeriodeBorne = {
  debut: Date;
  fin: Date;
  label: string; // displayed on screen, e.g. "du 1er janvier au 7 août 2026"
};

export type ComparaisonMode =
  | "aucune"
  | "periode_precedente"
  | "meme_periode_n1"
  | "moyenne_12_mois";

export const COMPARAISON_MODES = [
  "aucune",
  "periode_precedente",
  "meme_periode_n1",
  "moyenne_12_mois",
] as const satisfies ComparaisonMode[];

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export function fmtDate(d: Date): string {
  const j = d.getDate();
  const m = MOIS_FR[d.getMonth()];
  return `${j === 1 ? "1er" : j} ${m} ${d.getFullYear()}`;
}

export function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/**
 * Resolve a raw `periode` query string + optional `debut`/`fin` into concrete bounds.
 * The `today` parameter is injectable for testing.
 */
export function parsePeriode(
  raw?: string,
  debut?: string,
  fin?: string,
  today: Date = new Date(),
): PeriodeBorne {
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-based

  if (raw === "mois") {
    const d = new Date(y, m, 1);
    const f = endOfDay(new Date(y, m + 1, 0));
    return { debut: d, fin: f, label: `${MOIS_FR[m]} ${y}` };
  }

  if (raw === "trimestre") {
    const q = Math.floor(m / 3);
    const d = new Date(y, q * 3, 1);
    const f = endOfDay(new Date(y, q * 3 + 3, 0));
    return { debut: d, fin: f, label: `T${q + 1} ${y}` };
  }

  if (raw === "exercice") {
    const d = new Date(y, 0, 1);
    const f = endOfDay(new Date(y, 11, 31));
    return { debut: d, fin: f, label: `exercice ${y}` };
  }

  if (raw === "12_mois" || (!raw && !debut)) {
    const f = endOfDay(new Date(today));
    const d = startOfDay(new Date(today));
    d.setFullYear(d.getFullYear() - 1);
    d.setDate(d.getDate() + 1);
    return { debut: d, fin: f, label: `du ${fmtDate(d)} au ${fmtDate(f)}` };
  }

  // Custom period: debut + fin required
  if (debut && fin) {
    const d = startOfDay(new Date(debut));
    const f = endOfDay(new Date(fin));
    if (!isNaN(d.getTime()) && !isNaN(f.getTime()) && f >= d) {
      return { debut: d, fin: f, label: `du ${fmtDate(d)} au ${fmtDate(f)}` };
    }
  }

  // Fallback: 12 mois glissants
  const f = endOfDay(new Date(today));
  const d = startOfDay(new Date(today));
  d.setFullYear(d.getFullYear() - 1);
  d.setDate(d.getDate() + 1);
  return { debut: d, fin: f, label: `du ${fmtDate(d)} au ${fmtDate(f)}` };
}

/**
 * Compute the preceding period of the same duration.
 * Example: 1 jan → 31 mar  →  preceding: 1 oct (prev year) → 31 dec (prev year)
 */
export function periodePrecedente(p: PeriodeBorne): PeriodeBorne {
  const durationMs = p.fin.getTime() - p.debut.getTime();
  const f = new Date(p.debut.getTime() - 1); // 1 ms before current start
  const d = new Date(f.getTime() - durationMs);
  return { debut: d, fin: f, label: `du ${fmtDate(d)} au ${fmtDate(f)}` };
}

/**
 * Compute the same period one year ago (same calendar bounds, Y-1).
 */
export function memePeriodeN1(p: PeriodeBorne): PeriodeBorne {
  const d = new Date(p.debut);
  const f = new Date(p.fin);
  d.setFullYear(d.getFullYear() - 1);
  f.setFullYear(f.getFullYear() - 1);
  return { debut: d, fin: f, label: `du ${fmtDate(d)} au ${fmtDate(f)}` };
}

/**
 * Validate that two periods have the same duration (within 24 h tolerance).
 * Spec §6: "TOUJOURS À DATE COMPARABLE."
 *
 * This function is tested by a dedicated vitest test (analytics-periods.test.ts)
 * that MUST FAIL if two ranges of different lengths are ever accepted.
 */
export function assertDurationEqual(a: PeriodeBorne, b: PeriodeBorne): void {
  const dA = a.fin.getTime() - a.debut.getTime();
  const dB = b.fin.getTime() - b.debut.getTime();
  const tolerance = 24 * 60 * 60 * 1000; // 24 h
  if (Math.abs(dA - dB) > tolerance) {
    throw new Error(
      `Périodes incomparables : "${a.label}" dure ${Math.round(dA / 86400000)} jours, ` +
        `"${b.label}" dure ${Math.round(dB / 86400000)} jours. ` +
        `Les deux bornes doivent avoir la même longueur.`,
    );
  }
}

/**
 * Return the last N calendar months as discrete PeriodeBorne objects,
 * ordered oldest → newest. Used for "moyenne_12_mois" comparisons.
 * The `today` parameter is injectable for testing.
 */
export function getLast12Months(today: Date = new Date(), n = 12): PeriodeBorne[] {
  const months: PeriodeBorne[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const ref = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const d = startOfDay(ref);
    const f = endOfDay(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
    months.push({ debut: d, fin: f, label: `${MOIS_FR[ref.getMonth()]} ${ref.getFullYear()}` });
  }
  return months;
}

/**
 * Human-readable sentence explaining why a comparison is impossible.
 * Spec §7: "une phrase, pas un tiret dans une case."
 */
export function messageImpossible(
  mode: Exclude<ComparaisonMode, "aucune">,
  periode: PeriodeBorne,
  today: Date = new Date(),
): string {
  if (mode === "meme_periode_n1") {
    // Tell the user when the data will first be available
    const readyMonth = new Date(periode.debut);
    readyMonth.setFullYear(readyMonth.getFullYear() + 1);
    const label = `${MOIS_FR[readyMonth.getMonth()]} ${readyMonth.getFullYear()}`;
    return `Pas encore de point de comparaison pour cette période — il faudra attendre ${label}.`;
  }
  if (mode === "periode_precedente") {
    return `Pas encore assez de données pour la période précédente.`;
  }
  if (mode === "moyenne_12_mois") {
    return `Pas encore assez de mois complets pour calculer une moyenne — il faut au moins 3 mois.`;
  }
  return `Comparaison non disponible.`;
}
