/**
 * BUSINESS_TABLES parity guard — CLAUDE.md §1 (isolation multi-tenant).
 *
 * The rule: every business table (any table carrying `tenant_id`) must appear
 * in BUSINESS_TABLES of BOTH `helpers.ts` (used by cleanupTenants) and
 * `rls.test.ts` (used by the isolation test loop).
 *
 * Why a dedicated guard: `avoirs` and `facture_sequences` sat in helpers.ts but
 * were missing from rls.test.ts. Both carry `tenant_id` and have RLS
 * ENABLE+FORCE, so the `pg_class` guard in ci.yml passed — it checks the
 * DATABASE state, not the TEST coverage. The result was two invoicing tables
 * whose isolation was never actually exercised, with nothing going red.
 *
 * This guard reads both source files textually rather than importing them:
 * importing rls.test.ts would execute its whole suite (tenant creation, DB
 * setup). Same approach as llm-single-exit.test.ts and anti-sdk.test.ts.
 *
 * What to do when this test fails: add the named table(s) to whichever list is
 * missing them — and, for rls.test.ts, also add a `tableInsertSql` entry in
 * helpers.ts, otherwise the isolation test seeds nothing and fails on
 * `countA >= 1`.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const HELPERS_PATH = join(__dirname, "helpers.ts");
const RLS_TEST_PATH = join(__dirname, "rls.test.ts");

/**
 * Extract the string literals of the `BUSINESS_TABLES` array from a source
 * file. Throws — rather than returning an empty set — when the declaration
 * cannot be found, so that renaming or reshaping the constant fails the guard
 * loudly instead of silently disabling it.
 */
function extractBusinessTables(filePath: string): string[] {
  const src = readFileSync(filePath, "utf8");
  const match = src.match(/const BUSINESS_TABLES\s*(?::[^=]+)?=\s*\[([^\]]*)\]/);
  if (!match) {
    throw new Error(
      `BUSINESS_TABLES declaration not found in ${filePath}. ` +
        `This guard parses it textually — if the constant was renamed or ` +
        `restructured, update business-tables-parity.test.ts to match.`,
    );
  }
  // Les COMMENTAIRES sont retirés avant extraction.
  //
  // Sans cela, une apostrophe dans un commentaire — « les enfants d'abord » —
  // ouvre une chaîne fictive, et la garde signalait des doublons imaginaires
  // (`',\n  '`). Elle interdisait donc de fait d'expliquer l'ordre de la liste,
  // alors que cet ordre est subtil : les enfants avant les parents, à cause des
  // clés étrangères.
  //
  // Troisième garde de ce dépôt à buter sur la même chose : une garde qui
  // refuse les commentaires décourage les commentaires.
  const sansCommentaires = match[1]!.replace(/\/\/[^\n]*/g, "");
  const names = [...sansCommentaires.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!);
  if (names.length === 0) {
    throw new Error(`BUSINESS_TABLES in ${filePath} parsed as empty.`);
  }
  return names;
}

describe("BUSINESS_TABLES — parité entre helpers.ts et rls.test.ts", () => {
  const helpers = extractBusinessTables(HELPERS_PATH);
  const rlsTest = extractBusinessTables(RLS_TEST_PATH);

  test("les deux listes sont non vides et parsées correctement", () => {
    expect(helpers.length).toBeGreaterThan(0);
    expect(rlsTest.length).toBeGreaterThan(0);
  });

  test("aucune table de helpers.ts n'est absente de rls.test.ts", () => {
    const missing = helpers.filter((t) => !rlsTest.includes(t)).sort();
    expect(
      missing,
      `Ces tables sont dans BUSINESS_TABLES de helpers.ts mais PAS dans celle de ` +
        `rls.test.ts — leur isolation multi-tenant n'est donc jamais testée : ` +
        `${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("aucune table de rls.test.ts n'est absente de helpers.ts", () => {
    const missing = rlsTest.filter((t) => !helpers.includes(t)).sort();
    expect(
      missing,
      `Ces tables sont dans BUSINESS_TABLES de rls.test.ts mais PAS dans celle de ` +
        `helpers.ts — cleanupTenants ne purgera pas leurs lignes de test : ` +
        `${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("aucun doublon dans l'une ou l'autre liste", () => {
    const dupes = (list: string[]) =>
      [...new Set(list.filter((t, i) => list.indexOf(t) !== i))].sort();
    expect(dupes(helpers), `Doublons dans helpers.ts`).toEqual([]);
    expect(dupes(rlsTest), `Doublons dans rls.test.ts`).toEqual([]);
  });
});
