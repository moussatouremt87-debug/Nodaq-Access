/**
 * Business-date timezone guard — enforces that a calendar day (an invoice
 * date, a period boundary, a due date — a DATE MÉTIER) is never produced via
 * `toISOString().slice(0, 10)` or `toISOString().split("T")[0]`.
 *
 * Why this matters: `toISOString()` first converts a Date to UTC. A business
 * date built from LOCAL components (`new Date(y, m, d)`, or simply "now") and
 * then read back through `toISOString()` silently shifts by one day in any
 * timezone ahead of UTC — e.g. an invoice dated 2026-09-01, read from
 * Postgres and rendered with `toISOString().slice(0, 10)`, prints
 * "2026-08-31" in Europe/Paris. Use `toDateString()` from `@nodaq/shared`
 * (or the browser-side duplicate in artifacts/nodaq/src/lib/format.ts)
 * instead — it reads the LOCAL year/month/day components.
 *
 * `toISOString()` IS correct for an INSTANT — a point in time compared or
 * stored as `timestamptz` (e.g. routes/analytics.ts:607-608, comparing
 * `created_at` against period bounds as absolute instants). It is also
 * correct when a Date was itself built AND is read back entirely in UTC
 * (`Date.UTC(...)` in → `toISOString()` out) — the round-trip never touches
 * local time, so it's timezone-invariant by construction. These call sites
 * are marked in source with a `tz-guard-allow:` comment on the line itself
 * or the line immediately above; this guard skips lines marked that way, but
 * every marker must still be paired with a real justification — grep the
 * codebase for `tz-guard-allow` to review them:
 *   - lib/shared/src/capex.ts — IS installment dates: Date.UTC in, toISOString out
 *   - lib/fec/src/derive.ts (addDays) — parsed at UTC midnight, formatted via toISOString
 *   - artifacts/api-server/src/services/planning-service.ts (toISODate, getFeriesAnnee)
 *     — this module's whole calendar arithmetic is UTC-anchored; callers must
 *     normalize "today" first (see todayForPlanning() in routes/equipe.ts)
 *
 * Modeled on the single-exit guard in llm-single-exit.test.ts.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const FORBIDDEN_RE = /\.toISOString\(\)\.(?:slice\(0,\s*10\)|split\(["']T["']\)\[0\])/;

const ALLOW_MARKER = "tz-guard-allow";

const FIX_MESSAGE =
  "Une DATE MÉTIER (jour calendaire) ne doit jamais être formatée avec toISOString().slice(0, 10) " +
  "ou toISOString().split(\"T\")[0] — utilise toDateString() (composantes locales) depuis @nodaq/shared. " +
  "Si ce cas est un INSTANT légitime (timestamptz, ou construction+lecture entièrement en UTC), " +
  "documente-le avec un commentaire `tz-guard-allow: <raison>` sur la ligne ou la ligne au-dessus.";

// ─── File collection (mirrors llm-single-exit.test.ts pattern) ───────────────

function collectSourceFiles(dir: string): string[] {
  let results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "__tests__", "test", ".git"].includes(entry.name)) continue;
      results = results.concat(collectSourceFiles(full));
    } else if (entry.isFile()) {
      const n = entry.name;
      if (
        (n.endsWith(".ts") || n.endsWith(".tsx") || n.endsWith(".js")) &&
        !n.endsWith(".d.ts") &&
        !n.endsWith(".test.ts") &&
        !n.endsWith(".test.tsx") &&
        !n.endsWith(".spec.ts")
      ) {
        results.push(full);
      }
    }
  }
  return results;
}

function safeCollectSourceFiles(dir: string): string[] {
  try {
    return collectSourceFiles(dir);
  } catch {
    return []; // directory may not exist in all environments
  }
}

const WORKSPACE_ROOT = resolve(__dirname, "../../../../");

/** Collect artifacts/<name>/src and lib/<name>/src directories that exist. */
function getScanDirs(): string[] {
  const dirs: string[] = [];
  for (const base of ["artifacts", "lib"]) {
    const baseDir = join(WORKSPACE_ROOT, base);
    const top = readdirSync(baseDir, { withFileTypes: true });
    for (const entry of top) {
      if (entry.isDirectory()) {
        const srcDir = join(baseDir, entry.name, "src");
        try {
          statSync(srcDir);
          dirs.push(srcDir);
        } catch {
          // no src/ sub-directory — skip
        }
      }
    }
  }
  return dirs;
}

const SCAN_DIRS = getScanDirs();
const ALL_FILES = SCAN_DIRS.flatMap(safeCollectSourceFiles);

// ─── Helper: find violating lines, respecting tz-guard-allow markers ────────

function findViolatingLines(file: string, content: string): string[] {
  const lines = content.split("\n");
  const violations: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!FORBIDDEN_RE.test(line)) continue;
    const markedOnSameLine = line.includes(ALLOW_MARKER);
    const markedOnLineAbove = i > 0 && lines[i - 1]!.includes(ALLOW_MARKER);
    if (markedOnSameLine || markedOnLineAbove) continue;
    violations.push(`${file.replace(WORKSPACE_ROOT, "")}:${i + 1}: ${line.trim()}`);
  }
  return violations;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Business-date timezone guard — no toISOString().slice(0, 10) / .split(\"T\")[0]", () => {
  test("collected source files to scan (must be > 0)", () => {
    expect(ALL_FILES.length).toBeGreaterThan(0);
  });

  test("no business date is formatted via toISOString() sliced or split", () => {
    const violations: string[] = [];
    for (const file of ALL_FILES) {
      const src = readFileSync(file, "utf8");
      violations.push(...findViolatingLines(file, src));
    }
    expect(violations, `${FIX_MESSAGE}\n\n${violations.join("\n")}`).toHaveLength(0);
  });
});
