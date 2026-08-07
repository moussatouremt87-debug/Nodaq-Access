/**
 * Anti-SDK guard — enforces the rule that no provider SDK (openai, @mistralai/mistralai,
 * @anthropic-ai/sdk, …) is imported directly in application source code.
 *
 * All model calls MUST go through @nodaq/llm which uses plain fetch.
 * This test fails CI if a forbidden SDK import is detected in:
 *   artifacts/api-server/src/**
 *   lib/**  (excluding node_modules, dist, __tests__)
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const FORBIDDEN_PKGS = [
  "@mistralai/mistralai",
  "openai",
  "@anthropic-ai/sdk",
  "@anthropic-ai/anthropic-sdk",
  "anthropic",
  "@google/generative-ai",
  "@google-ai/generativelanguage",
  "groq-sdk",
  "cohere-ai",
  "cohere",
  "@cohere-ai/cohere-sdk",
  "@xai-org/grok-sdk",
];

// Build a regex that catches:
//   import ... from "pkg"
//   import("pkg")
//   require("pkg")
function buildPattern(pkg: string): RegExp {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:from|import|require)\\s*\\(?['"]\s*${escaped}['"]`, "m");
}

const PATTERNS = FORBIDDEN_PKGS.map((pkg) => ({ pkg, re: buildPattern(pkg) }));

function collectSourceFiles(dir: string): string[] {
  let results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "__tests__", ".git"].includes(entry.name)) continue;
      results = results.concat(collectSourceFiles(full));
    } else if (entry.isFile()) {
      if ((entry.name.endsWith(".ts") || entry.name.endsWith(".js")) && !entry.name.endsWith(".d.ts")) {
        results.push(full);
      }
    }
  }
  return results;
}

// Scan from the workspace root (this test runs in artifacts/api-server)
const WORKSPACE_ROOT = resolve(__dirname, "../../../../");

const SCAN_DIRS = [
  join(WORKSPACE_ROOT, "artifacts/api-server/src"),
  join(WORKSPACE_ROOT, "lib"),
];

describe("Anti-SDK guard — no direct provider SDK imports in application code", () => {
  const allFiles = SCAN_DIRS.flatMap(collectSourceFiles);

  test("collected source files to scan (must be > 0)", () => {
    expect(allFiles.length).toBeGreaterThan(0);
  });

  test.each(FORBIDDEN_PKGS)("no import of '%s' in scanned files", (pkg) => {
    const pattern = PATTERNS.find((p) => p.pkg === pkg)!.re;
    const violations: string[] = [];

    for (const file of allFiles) {
      const src = readFileSync(file, "utf8");
      if (pattern.test(src)) {
        violations.push(file.replace(WORKSPACE_ROOT, ""));
      }
    }

    expect(violations, `Found direct import of "${pkg}" in:\n${violations.join("\n")}`).toHaveLength(0);
  });
});
