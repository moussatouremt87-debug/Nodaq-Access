/**
 * Period utilities for the analytics engine.
 *
 * Rule (spec 4.11 §5):
 *  - Default comparison is SAME PERIOD LAST YEAR, not previous period.
 *  - If Y-1 does not exist yet, fall back to 12-month rolling.
 *  - Two ranges must have the same duration — the engine enforces this.
 */

export type PeriodeBorne = {
  debut: Date;
  fin: Date;
  label: string; // displayed on screen, e.g. "du 1er janvier au 7 août 2026"
};

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function fmtDate(d: Date): string {
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
 * Example: 1 jan → 31 mar   → preceding: 1 oct prev year → 31 dec prev year
 */
export function periodePrecedente(p: PeriodeBorne): PeriodeBorne {
  const durationMs = p.fin.getTime() - p.debut.getTime();
  const f = new Date(p.debut.getTime() - 1); // ms before current start
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
 * Required by spec §6: "TOUJOURS À DATE COMPARABLE".
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
