/**
 * LLM single-exit guard — enforces that all model traffic is routed through
 * LLM_BASE_URL, resolved in lib/llm.
 *
 * This test fails CI if any source file contains:
 *   - A hardcoded provider URL: api.mistral.ai, api.scaleway.ai, api.openai.com,
 *     api.anthropic.com, generativelanguage.googleapis.com
 *   - A banned environment variable name: MISTRAL_API_KEY, SCALEWAY_API_KEY,
 *     LITELLM_BASE_URL, LITELLM_API_KEY
 *
 * Scanned: artifacts-name-src and lib-name-src (excluding node_modules,
 * dist, __tests__, test files).
 *
 * What to do when this test fails:
 *   Move the flagged URL or key reference into lib/llm/src/client.ts and read it
 *   via getConfig() / LLM_BASE_URL.  Every destination for model data must come
 *   from LLM_BASE_URL, resolved in lib/llm — never hardcoded, never resolved in
 *   application code outside that library.
 *
 * Inspired by the withTenant invariant guard in rls.test.ts and the pattern
 * already established in anti-sdk.test.ts.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

// ─── Forbidden patterns ────────────────────────────────────────────────────────

/** Regex matching hardcoded provider base URLs. */
const FORBIDDEN_URL_RE =
  /https?:\/\/(?:api\.mistral\.ai|api\.scaleway\.ai|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com)/;

/**
 * Banned environment variable names that must not appear in source.
 *
 * PORTÉE : cette garde vise les identifiants de FOURNISSEURS DE MODÈLES. Elle
 * interdit `SCALEWAY_API_KEY` parce que Scaleway est ici un fournisseur
 * d'inférence, et que toute sortie modèle doit passer par LLM_BASE_URL.
 *
 * Les AUTRES services Scaleway (envoi transactionnel, stockage…) ne sont pas
 * concernés et portent des noms distincts — `TEM_API_KEY` pour l'envoi. Si vous
 * arrivez ici parce que la CI a refusé votre variable, ne contournez pas la
 * garde : renommez la variable pour qu'elle dise de quel service elle parle.
 */
const FORBIDDEN_ENV_VARS = [
  "MISTRAL_API_KEY",
  "SCALEWAY_API_KEY",
  "LITELLM_BASE_URL",
  "LITELLM_API_KEY",
];

const FIX_MESSAGE =
  "Toute destination de modèle doit venir de LLM_BASE_URL, résolue dans lib/llm.";

// ─── File collection (mirrors anti-sdk.test.ts pattern exactly) ──────────────

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

// ─── Helper: find violating lines ────────────────────────────────────────────

function findViolatingLines(file: string, content: string, re: RegExp): string[] {
  return content
    .split("\n")
    .flatMap((line, i) =>
      re.test(line) ? [`${file.replace(WORKSPACE_ROOT, "")}:${i + 1}: ${line.trim()}`] : [],
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LLM single-exit guard — no hardcoded provider URLs or banned env vars in source", () => {
  test("collected source files to scan (must be > 0)", () => {
    expect(ALL_FILES.length).toBeGreaterThan(0);
  });

  test("no hardcoded provider URL in scanned files", () => {
    const violations: string[] = [];
    for (const file of ALL_FILES) {
      const src = readFileSync(file, "utf8");
      violations.push(...findViolatingLines(file, src, FORBIDDEN_URL_RE));
    }
    expect(
      violations,
      `Hardcoded provider URL found — ${FIX_MESSAGE}\n\n${violations.join("\n")}`,
    ).toHaveLength(0);
  });

  test.each(FORBIDDEN_ENV_VARS)(
    "env var '%s' must not appear in scanned files",
    (envVar) => {
      const re = new RegExp(`\\b${envVar}\\b`);
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        const src = readFileSync(file, "utf8");
        violations.push(...findViolatingLines(file, src, re));
      }
      expect(
        violations,
        `Banned env var "${envVar}" found — ${FIX_MESSAGE}\n\n${violations.join("\n")}`,
      ).toHaveLength(0);
    },
  );
});

// ─── Unit test: getConfig() throws LlmConfigError when LLM_BASE_URL is absent ──

describe("getConfig() lève LlmConfigError quand LLM_BASE_URL est absente", () => {
  test("throws LlmConfigError naming LLM_BASE_URL", async () => {
    const { getConfig, LlmConfigError } = await import("@nodaq/llm");
    const saved = process.env["LLM_BASE_URL"];
    delete process.env["LLM_BASE_URL"];
    try {
      expect(() => getConfig()).toThrow(LlmConfigError);
      expect(() => getConfig()).toThrow(/LLM_BASE_URL/);
    } finally {
      if (saved !== undefined) process.env["LLM_BASE_URL"] = saved;
    }
  });
});
