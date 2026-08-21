/**
 * Connecteur bancaire (Bridge) single-exit guard — enforces that
 * BRIDGE_CLIENT_ID, BRIDGE_CLIENT_SECRET and BRIDGE_WEBHOOK_SECRET are read
 * in exactly one place: lib/banque-agreee/src/client.ts.
 *
 * Copie du patron de plateforme-agreee-single-exit.test.ts. Contrairement à
 * la PA (aucun fournisseur choisi), Bridge EST le fournisseur retenu — mais
 * l'invariant à protéger reste le même : personne d'autre que `client.ts`
 * ne doit lire ces variables directement.
 *
 * Scanned: artifacts/<name>/src et lib/<name>/src (hors node_modules, dist,
 * __tests__, fichiers de test), à l'EXCEPTION de
 * lib/banque-agreee/src/client.ts lui-même.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

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
const ALLOWED_FILE = resolve(WORKSPACE_ROOT, "lib/banque-agreee/src/client.ts");

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

function findViolatingLines(file: string, content: string, re: RegExp): string[] {
  return content
    .split("\n")
    .flatMap((line, i) =>
      re.test(line) ? [`${file.replace(WORKSPACE_ROOT, "")}:${i + 1}: ${line.trim()}`] : [],
    );
}

const FIX_MESSAGE =
  "Les variables BRIDGE_* ne doivent être lues que dans lib/banque-agreee/src/client.ts — voir getConfig() et secretWebhookPaiement().";

describe("Connecteur bancaire single-exit guard — variables Bridge lues nulle part ailleurs", () => {
  test("collected source files to scan (must be > 0)", () => {
    expect(ALL_FILES.length).toBeGreaterThan(0);
  });

  // BRIDGE_PAYMENT_WEBHOOK_SECRET s'ajoute au ticket 4.19 : une garde qui ne
  // couvre que les variables d'hier laisse passer celles de demain, et c'est
  // exactement comme ça qu'un secret finit lu depuis une route.
  test.each([
    "BRIDGE_CLIENT_ID",
    "BRIDGE_CLIENT_SECRET",
    "BRIDGE_WEBHOOK_SECRET",
    "BRIDGE_PAYMENT_CLIENT_ID",
    "BRIDGE_PAYMENT_CLIENT_SECRET",
    "BRIDGE_PAYMENT_WEBHOOK_SECRET",
  ])(
    "env var '%s' must not appear outside lib/banque-agreee/src/client.ts",
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

describe("getConfig() lève BanqueConfigError quand BRIDGE_CLIENT_ID est absente", () => {
  test("throws BanqueConfigError naming BRIDGE_CLIENT_ID", async () => {
    const { getConfig, BanqueConfigError } = await import("@nodaq/banque-agreee");
    const saved = process.env["BRIDGE_CLIENT_ID"];
    delete process.env["BRIDGE_CLIENT_ID"];
    try {
      expect(() => getConfig()).toThrow(BanqueConfigError);
      expect(() => getConfig()).toThrow(/BRIDGE_CLIENT_ID/);
    } finally {
      if (saved !== undefined) process.env["BRIDGE_CLIENT_ID"] = saved;
    }
  });
});
