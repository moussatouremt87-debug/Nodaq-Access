/**
 * Garde de parité — un module ne déclare pas un outil qui n'existe pas.
 *
 * Pendant de `artifacts/nodaq/src/lib/modules-parite.test.ts`, qui tient le
 * versant NAVIGATION. Celui-ci tient le versant AGENT, et il ne peut vivre
 * que dans ce paquet : la boîte à outils est déclarée dans
 * `lib/mistralAgent.ts`.
 *
 * ── Ce qu'elle aurait évité ──────────────────────────────────────────────
 * Le catalogue annonçait TREIZE outils — `plan_staffing`,
 * `check_stock_alerts`, `forecast_sales`, `silae_get_employees`… — et pas un
 * seul n'existait côté serveur. `inactiveModuleTools()` était donc une
 * fonction qui rendait toujours l'ensemble vide, en promettant l'inverse :
 * éteindre un module semblait retirer des capacités à l'agent, sans jamais
 * rien retirer du tout.
 *
 * Le catalogue le dit pourtant noir sur blanc : « deactivating a module hides
 * its pages AND removes its agent tools from the toolset ». Une affirmation
 * qu'aucun outil réel ne soutenait.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULES, inactiveModuleTools, resolveModules } from "@nodaq/shared";

/**
 * Les noms d'outils réellement déclarés dans la boîte à outils de l'agent.
 *
 * Lus dans le SOURCE plutôt qu'importés : `mistralAgent.ts` tire la moitié du
 * serveur à l'import, et cette garde n'a besoin que de noms.
 */
function outilsDeclares(): Set<string> {
  const src = readFileSync(join(__dirname, "..", "lib", "mistralAgent.ts"), "utf8");
  const noms = [...src.matchAll(/^\s*name: "([a-z_]+)",$/gm)].map((m) => m[1]!);
  expect(
    noms.length,
    "aucun outil lu dans mistralAgent.ts — la garde ne compare plus rien",
  ).toBeGreaterThan(5);
  return new Set(noms);
}

describe("a — chaque outil annoncé par un module existe vraiment", () => {
  test("aucun module ne déclare un outil absent de la boîte à outils", () => {
    const declares = outilsDeclares();
    const fantomes: string[] = [];
    for (const m of MODULES) {
      for (const outil of m.tools) {
        if (!declares.has(outil)) fantomes.push(`${m.id} → ${outil}`);
      }
    }
    expect(
      fantomes,
      "ces modules annoncent des outils qui n'existent pas : éteindre le module ne retirerait rien à l'agent, contrairement à ce que le catalogue promet",
    ).toEqual([]);
  });
});

describe("b — l'extinction d'un module reste une opération honnête", () => {
  test("`inactiveModuleTools` ne rend que des outils réels", () => {
    // Tous les modules éteints, cas le plus large possible.
    const eteints = MODULES.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      tools: m.tools,
      active: false,
      source: "choix" as const,
    }));
    const declares = outilsDeclares();
    for (const outil of inactiveModuleTools(eteints)) {
      expect(declares.has(outil), `« ${outil} » n'existe pas côté serveur`).toBe(true);
    }
  });

  test("le résolveur reste appelable et rend un état par module", () => {
    // `resolveModules` n'est encore branché nulle part. Ce test le garde
    // vivant : le jour où on le branchera, il ne faudra pas découvrir qu'il a
    // dérivé pendant des mois sans que rien ne l'exerce.
    const resolus = resolveModules("batiment", {});
    expect(resolus).toHaveLength(MODULES.length);
    for (const r of resolus) {
      expect(typeof r.active).toBe("boolean");
      expect(["defaut_vertical", "hors_socle", "choix"]).toContain(r.source);
    }
  });

  test("un choix explicite l'emporte sur le défaut, dans les deux sens", () => {
    const horsSocle = MODULES.find((m) => m.defaultOn === "aucun");
    const socle = MODULES.find((m) => m.defaultOn === "tous");
    expect(horsSocle, "plus aucun module hors socle — le test ne prouve plus rien").toBeTruthy();
    expect(socle, "plus aucun module de socle").toBeTruthy();

    const allume = resolveModules("batiment", { [horsSocle!.id]: true });
    expect(allume.find((r) => r.id === horsSocle!.id)?.active).toBe(true);

    const eteint = resolveModules("batiment", { [socle!.id]: false });
    expect(eteint.find((r) => r.id === socle!.id)?.active).toBe(false);
  });
});
