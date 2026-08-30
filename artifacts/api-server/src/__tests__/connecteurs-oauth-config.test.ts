import { readFile, readdir } from "node:fs/promises";
import { extname } from "node:path";
import { describe, expect, test } from "vitest";

const ENV_EXAMPLE = new URL("../../../../.env.example", import.meta.url);
const FRONTEND_SOURCE = new URL("../../../nodaq/src/", import.meta.url);

const OAUTH_VARIABLES = [
  "PENNYLANE_OAUTH_CLIENT_ID",
  "PENNYLANE_OAUTH_CLIENT_SECRET",
  "STRIPE_OAUTH_CLIENT_ID",
  "STRIPE_PLATFORM_SECRET_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "SLACK_OAUTH_CLIENT_ID",
  "SLACK_OAUTH_CLIENT_SECRET",
] as const;

const CALLBACKS = [
  "https://app.nodaq.fr/api/connecteurs/PENNYLANE/retour",
  "https://app.nodaq.fr/api/connecteurs/STRIPE/retour",
  "https://app.nodaq.fr/api/connecteurs/GOOGLE_DRIVE/retour",
  "https://app.nodaq.fr/api/connecteurs/SLACK/retour",
] as const;

async function fichiersSource(repertoire: URL): Promise<URL[]> {
  const entrees = await readdir(repertoire, { withFileTypes: true });
  const fichiers = await Promise.all(entrees.map(async (entree) => {
    const url = new URL(entree.name + (entree.isDirectory() ? "/" : ""), repertoire);
    if (entree.isDirectory()) return fichiersSource(url);
    return [url];
  }));
  return fichiers.flat();
}

describe("configuration OAuth des connecteurs", () => {
  test("documente les huit identifiants plateforme sans valeur par défaut", async () => {
    const exemple = await readFile(ENV_EXAMPLE, "utf8");

    for (const variable of OAUTH_VARIABLES) {
      const declarations = exemple.match(new RegExp(`^${variable}=(.*)$`, "gm")) ?? [];
      expect(declarations, `${variable} doit être déclaré exactement une fois`).toEqual([`${variable}=`]);
    }
  });

  test("documente les quatre URI de rappel de production exactes", async () => {
    const exemple = await readFile(ENV_EXAMPLE, "utf8");
    for (const callback of CALLBACKS) expect(exemple).toContain(callback);
    expect(exemple).toMatch(/^APP_URL=https:\/\/app\.yourdomain\.com$/m);
    expect(exemple).toContain("par son PUBLIC_URL");
    expect(exemple).toMatch(/^STRIPE_CONNECT_ALLOW_TEST_MODE=false$/m);
  });

  test("n'expose ni configuration OAuth serveur ni secret plausible dans le front", async () => {
    const sources = await fichiersSource(FRONTEND_SOURCE);
    const textes = await Promise.all(
      sources
        .filter((fichier) =>
          [".ts", ".tsx", ".js", ".jsx"].includes(extname(fichier.pathname))
          && !fichier.pathname.includes(".test.")
          && !fichier.pathname.includes("/__tests__/"),
        )
        .map((fichier) => readFile(fichier, "utf8")),
    );
    const front = textes.join("\n");

    for (const variable of OAUTH_VARIABLES) expect(front).not.toContain(variable);
    expect(front).not.toMatch(/\b(?:sk_live|whsec|pyl|xox[baprs])_[A-Za-z0-9_-]{12,}\b/);
  });
});
