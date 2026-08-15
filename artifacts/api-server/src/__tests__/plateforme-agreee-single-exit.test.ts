/**
 * Plateforme agréée (PA) single-exit guard — enforces that PA_BASE_URL and
 * PA_API_KEY are read in exactly one place: lib/plateforme-agreee/src/client.ts.
 *
 * Copie du patron de llm-single-exit.test.ts, avec une adaptation délibérée :
 * ce guard-là interdit des URL de FOURNISSEURS CONCURRENTS CONNUS (Mistral,
 * OpenAI…). Ici, aucune plateforme agréée n'est encore choisie/contractée
 * (US-A2.6) — il n'existe donc aucun domaine concurrent connu à interdire.
 * L'invariant qui reste vérifiable et utile est plus direct : PERSONNE
 * d'autre que `client.ts` ne doit lire `process.env["PA_BASE_URL"]` ou
 * `process.env["PA_API_KEY"]` directement. Le jour où un contrat PA existe
 * et qu'un vrai domaine doit être banni, ce test peut être étendu avec la
 * même liste `FORBIDDEN_URL_RE` que llm-single-exit.test.ts.
 *
 * Scanned: artifacts/<name>/src et lib/<name>/src (hors node_modules, dist,
 * __tests__, fichiers de test), à l'EXCEPTION de lib/plateforme-agreee/src/client.ts
 * lui-même — seul fichier autorisé à lire ces deux variables.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

// ─── File collection (mirrors llm-single-exit.test.ts exactly) ───────────────

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

function safeCollectSourceFiles(dir: string): string[] {
  try {
    return collectSourceFiles(dir);
  } catch {
    return []; // directory may not exist in all environments
  }
}

const WORKSPACE_ROOT = resolve(__dirname, "../../../../");
const ALLOWED_FILE = resolve(WORKSPACE_ROOT, "lib/plateforme-agreee/src/client.ts");

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
const ALL_FILES = SCAN_DIRS.flatMap(safeCollectSourceFiles).filter((f) => resolve(f) !== ALLOWED_FILE);

// ─── Helper: find violating lines ────────────────────────────────────────────

function findViolatingLines(file: string, content: string, re: RegExp): string[] {
  return content
    .split("\n")
    .flatMap((line, i) =>
      re.test(line) ? [`${file.replace(WORKSPACE_ROOT, "")}:${i + 1}: ${line.trim()}`] : [],
    );
}

const FIX_MESSAGE =
  "PA_BASE_URL et PA_API_KEY ne doivent être lues que dans lib/plateforme-agreee/src/client.ts — voir getConfig().";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Plateforme agréée single-exit guard — PA_BASE_URL/PA_API_KEY lues nulle part ailleurs", () => {
  test("collected source files to scan (must be > 0)", () => {
    expect(ALL_FILES.length).toBeGreaterThan(0);
  });

  test.each(["PA_BASE_URL", "PA_API_KEY"])(
    "env var '%s' must not appear outside lib/plateforme-agreee/src/client.ts",
    (envVar) => {
      const re = new RegExp(`\\b${envVar}\\b`);
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        const src = readFileSync(file, "utf8");
        violations.push(...findViolatingLines(file, src, re));
      }
      expect(
        violations,
        `"${envVar}" trouvée hors de client.ts — ${FIX_MESSAGE}\n\n${violations.join("\n")}`,
      ).toHaveLength(0);
    },
  );
});

// ─── Unit test: getConfig() throws PaConfigError when PA_BASE_URL is absent ───

describe("getConfig() lève PaConfigError quand PA_BASE_URL est absente", () => {
  test("throws PaConfigError naming PA_BASE_URL", async () => {
    const { getConfig, PaConfigError } = await import("@nodaq/plateforme-agreee");
    const saved = process.env["PA_BASE_URL"];
    delete process.env["PA_BASE_URL"];
    try {
      expect(() => getConfig()).toThrow(PaConfigError);
      expect(() => getConfig()).toThrow(/PA_BASE_URL/);
    } finally {
      if (saved !== undefined) process.env["PA_BASE_URL"] = saved;
    }
  });
});
