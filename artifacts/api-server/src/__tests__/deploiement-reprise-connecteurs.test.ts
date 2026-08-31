/** Garde de deploiement : la reprise doit preceder chaque demarrage Docker. */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const RACINE = resolve(__dirname, "../../../..");
const dockerfile = readFileSync(resolve(RACINE, "Dockerfile"), "utf8");
const cheminDemarrage = resolve(RACINE, "lib/db/scripts/start-api.sh");
const migrations = readFileSync(
  resolve(RACINE, "lib/db/scripts/migrate.mjs"),
  "utf8",
);

describe("deploiement de la reprise des secrets de connecteurs", () => {
  test("l'image embarque un runner JS bundle avec crypto, jamais du TypeScript sous node_modules", () => {
    expect(dockerfile).toContain(
      "../../lib/db/scripts/migrate-connector-secrets.mjs --bundle",
    );
    expect(dockerfile).toContain(
      "--outfile=/workspace/migrate-connector-secrets.runtime.mjs",
    );
    expect(dockerfile).toContain(
      "/workspace/migrate-connector-secrets.runtime.mjs ./migrate-connector-secrets.mjs",
    );
    expect(dockerfile).not.toContain(
      "/workspace/lib/crypto/src ./node_modules/@nodaq/crypto/src",
    );
  });

  test("le CMD passe par un demarrage qui migre, retire les droits owner puis lance l'API", () => {
    expect(existsSync(cheminDemarrage)).toBe(true);
    expect(dockerfile).toContain(
      "/workspace/lib/db/scripts/start-api.sh ./start-api.sh",
    );
    expect(dockerfile).toContain('CMD ["sh", "./start-api.sh"]');

    const demarrage = existsSync(cheminDemarrage)
      ? readFileSync(cheminDemarrage, "utf8")
      : "";
    const migration = demarrage.indexOf("node ./migrate.mjs");
    const retraitOwner = demarrage.indexOf("unset DATABASE_URL");
    const api = demarrage.indexOf(
      "exec node --enable-source-maps ./dist/index.mjs",
    );
    expect(migration).toBeGreaterThanOrEqual(0);
    expect(retraitOwner).toBeGreaterThan(migration);
    expect(api).toBeGreaterThan(retraitOwner);
  });

  test("un verrou advisory global couvre SQL et reprise pour les rolling updates", () => {
    const verrou = migrations.indexOf("pg_advisory_lock");
    const reprise = migrations.indexOf("await reprendreSecretsConnecteurs()");
    const deverrouillage = migrations.indexOf("pg_advisory_unlock");
    expect(verrou).toBeGreaterThanOrEqual(0);
    expect(reprise).toBeGreaterThan(verrou);
    expect(deverrouillage).toBeGreaterThan(reprise);
  });
});
