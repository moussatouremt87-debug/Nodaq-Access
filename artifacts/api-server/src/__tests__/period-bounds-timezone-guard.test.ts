/**
 * Period-bounds timezone guard — enforces that PeriodeBorne date strings are
 * never produced via `toISOString().slice(0, 10)`.
 *
 * Why this matters: period bounds (`debut` / `fin`) are built with
 * `new Date(y, m, d)` — LOCAL time. `toISOString()` converts to UTC first,
 * so slicing the first 10 characters silently shifts the date backwards by
 * one day in any timezone ahead of UTC (e.g. Europe/Paris in summer). Use
 * `toDateString()` from `lib/analytics-periods.ts` instead — it reads the
 * LOCAL year/month/day components.
 *
 * This test fails CI if any source file contains `.debut.toISOString(` or
 * `.fin.toISOString(` followed by `.slice(` — the exact anti-pattern that
 * caused period bounds to be off by one day outside UTC.
 *
 * Modeled on the single-exit guard in llm-single-exit.test.ts.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

const FORBIDDEN_RE = /\.(?:debut|fin)\.toISOString\(\)\.slice\(/;

const FIX_MESSAGE =
  "Une borne de période (debut/fin) ne doit jamais être formatée avec toISOString().slice(0, 10) " +
  "— utilise toDateString() (composantes locales) depuis lib/analytics-periods.ts.";

function collectSourceFiles(dir: string): string[] {
  let results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "__tests__", ".git"].includes(entry.name)) continue;
      results = results.concat(collectSourceFiles(full));
    } else if (entry.isFile()) {
      const n = entry.name;
      if (
        (n.endsWith(".ts") || n.endsWith(".js")) &&
        !n.endsWith(".d.ts") &&
        !n.endsWith(".test.ts") &&
        !n.endsWith(".spec.ts")
      ) {
        results.push(full);
      }
    }
  }
  return results;
}

const SRC_DIR = resolve(__dirname, "..");
const ALL_FILES = collectSourceFiles(SRC_DIR);

function findViolatingLines(file: string, content: string): string[] {
  return content
    .split("\n")
    .flatMap((line, i) =>
      FORBIDDEN_RE.test(line) ? [`${file.replace(SRC_DIR, "src")}:${i + 1}: ${line.trim()}`] : [],
    );
}

describe("Period-bounds timezone guard — no toISOString().slice(0, 10) on debut/fin", () => {
  test("collected source files to scan (must be > 0)", () => {
    expect(ALL_FILES.length).toBeGreaterThan(0);
  });

  test("no period bound is formatted via toISOString().slice(", () => {
    const violations: string[] = [];
    for (const file of ALL_FILES) {
      const src = readFileSync(file, "utf8");
      violations.push(...findViolatingLines(file, src));
    }
    expect(violations, `${FIX_MESSAGE}\n\n${violations.join("\n")}`).toHaveLength(0);
  });
});
