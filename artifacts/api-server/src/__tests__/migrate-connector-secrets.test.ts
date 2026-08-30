/**
 * Reprise des secrets legacy de `connectors.config`.
 *
 * Le script travaille sur TOUTE la table avec le role proprietaire. Comme la
 * rotation de cle, il a donc sa propre base jetable : aucune reprise lancee ici
 * ne peut toucher les donnees d'un autre fichier execute en parallele.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { dechiffrer, chiffrer } from "@nodaq/crypto";
import { adminPool } from "./helpers";

const RACINE = resolve(__dirname, "../../../..");
const SCRIPT = "lib/db/scripts/migrate-connector-secrets.mjs";
const SCRIPT_MIGRATIONS = "lib/db/scripts/migrate.mjs";

let nomBase: string | null = null;
let urlBase = "";
let cible: pg.Pool;
let bundleRuntime = "";

function urlPourBase(url: string, nom: string): string {
  const u = new URL(url);
  u.pathname = `/${nom}`;
  return u.toString();
}

beforeAll(async () => {
  nomBase = `nodaq_connector_secrets_${Date.now()}_${randomBytes(3).toString("hex")}`;
  await adminPool.query(`CREATE DATABASE ${nomBase}`);
  urlBase = urlPourBase(process.env["DATABASE_URL"]!, nomBase);

  const migrations = spawnSync(
    process.execPath,
    ["lib/db/scripts/migrate.mjs"],
    {
      cwd: RACINE,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: urlBase },
    },
  );
  if (migrations.status !== 0)
    throw new Error(`migrations: ${migrations.stderr}`);
  bundleRuntime = resolve(
    RACINE,
    "artifacts/api-server",
    `.connector-secrets-runtime-${randomBytes(5).toString("hex")}.mjs`,
  );
  const bundle = spawnSync(
    "pnpm",
    [
      "--filter",
      "@workspace/api-server",
      "exec",
      "esbuild",
      "../../lib/db/scripts/migrate-connector-secrets.mjs",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--target=node24",
      "--external:pg",
      `--outfile=${bundleRuntime}`,
    ],
    { cwd: RACINE, encoding: "utf8", env: { ...process.env } },
  );
  if (bundle.status !== 0) throw new Error(`bundle: ${bundle.stderr}`);
  cible = new pg.Pool({ connectionString: urlBase });
}, 90_000);

afterEach(async () => {
  await cible.query("DELETE FROM tenant_secrets");
  await cible.query("DELETE FROM connectors");
  await cible.query("DELETE FROM tenants");
});

afterAll(async () => {
  await cible?.end();
  if (bundleRuntime) rmSync(bundleRuntime, { force: true });
  if (nomBase)
    await adminPool.query(`DROP DATABASE IF EXISTS ${nomBase} WITH (FORCE)`);
  nomBase = null;
}, 30_000);

async function creerConnecteur(
  config: Record<string, unknown>,
  options: { type?: string; status?: string } = {},
) {
  const tenantId = randomUUID();
  const connectorId = `legacy-${randomUUID()}`;
  // Fabrique une ligne HISTORIQUE. La migration 070 est deja installee sur la
  // base jetable et bloquerait, a raison, une nouvelle ecriture legacy. On
  // retire donc sa contrainte le temps de poser l'etat anterieur au deploiement,
  // puis on la remet NOT VALID comme le ferait la migration en rolling update.
  await cible.query(
    "ALTER TABLE connectors DROP CONSTRAINT IF EXISTS connectors_config_no_legacy_secrets",
  );
  await cible.query(
    "INSERT INTO tenants (id, nom) VALUES ($1::uuid, 'Legacy test')",
    [tenantId],
  );
  await cible.query(
    `INSERT INTO connectors (id, tenant_id, type, label, status, config)
     VALUES ($1, $2::uuid, $3, 'Legacy', $4, $5::jsonb)`,
    [
      connectorId,
      tenantId,
      options.type ?? "ZAPIER",
      options.status ?? "NON_CONNECTE",
      JSON.stringify(config),
    ],
  );
  await cible.query(
    `ALTER TABLE connectors
       ADD CONSTRAINT connectors_config_no_legacy_secrets
       CHECK (NOT (config ?| ARRAY[
         'apiKey', 'secretKey', 'webhookSecret', 'clientSecret', 'webhookUrl'
       ])) NOT VALID`,
  );
  return { tenantId, connectorId };
}

function lancer(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: RACINE,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: urlBase },
  });
}

function lancerMigrations() {
  return spawnSync(process.execPath, [SCRIPT_MIGRATIONS], {
    cwd: RACINE,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: urlBase },
  });
}

function lancerMigrationsAsync(): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const enfant = spawn(process.execPath, [SCRIPT_MIGRATIONS], {
      cwd: RACINE,
      env: { ...process.env, DATABASE_URL: urlBase },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    enfant.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    enfant.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    enfant.once("error", rejectPromise);
    enfant.once("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function lancerBundleRuntime() {
  return spawnSync(process.execPath, [bundleRuntime], {
    cwd: RACINE,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: urlBase },
  });
}

async function lireConfig(
  connectorId: string,
): Promise<Record<string, unknown>> {
  const { rows } = await cible.query(
    "SELECT config FROM connectors WHERE id = $1",
    [connectorId],
  );
  return rows[0].config as Record<string, unknown>;
}

async function lireConnecteur(connectorId: string) {
  const { rows } = await cible.query(
    "SELECT status, config FROM connectors WHERE id = $1",
    [connectorId],
  );
  return rows[0] as { status: string; config: Record<string, unknown> };
}

describe("reprise des secrets legacy de connecteurs", () => {
  test("le bundle JavaScript reel reprend un secret sans charger de TypeScript runtime", async () => {
    const clair = `bundle-${randomUUID()}`;
    const { tenantId, connectorId } = await creerConnecteur({ apiKey: clair });

    const reprise = lancerBundleRuntime();
    expect(reprise.status, reprise.stderr).toBe(0);
    const cle = `connecteur.${connectorId}.apiKey`;
    const { rows } = await cible.query(
      "SELECT valeur_chiffree FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle = $2",
      [tenantId, cle],
    );
    expect(dechiffrer(rows[0].valeur_chiffree, { scope: tenantId, cle })).toBe(
      clair,
    );
  });

  test("db:migrate enchaine obligatoirement la reprise owner", async () => {
    const clair = `via-db-migrate-${randomUUID()}`;
    const { tenantId, connectorId } = await creerConnecteur({
      apiKey: clair,
      dossier: "Factures",
    });

    const migrations = lancerMigrations();
    expect(migrations.status, migrations.stderr).toBe(0);
    expect(migrations.stdout).toContain("connector-secrets");
    expect(await lireConfig(connectorId)).toEqual({
      dossier: "Factures",
      __secrets: ["apiKey"],
    });
    const cle = `connecteur.${connectorId}.apiKey`;
    const { rows } = await cible.query(
      "SELECT valeur_chiffree FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle = $2",
      [tenantId, cle],
    );
    expect(dechiffrer(rows[0].valeur_chiffree, { scope: tenantId, cle })).toBe(
      clair,
    );

    const contrainte = await cible.query(
      `SELECT convalidated
         FROM pg_constraint
        WHERE conname = 'connectors_config_no_legacy_secrets'`,
    );
    expect(contrainte.rows).toEqual([{ convalidated: true }]);
  });

  test("deux replicas peuvent migrer ensemble sans course DDL ni double reprise", async () => {
    const clair = `rolling-${randomUUID()}`;
    const { connectorId } = await creerConnecteur({ apiKey: clair });

    const [premier, second] = await Promise.all([
      lancerMigrationsAsync(),
      lancerMigrationsAsync(),
    ]);
    expect(premier.code, premier.stderr).toBe(0);
    expect(second.code, second.stderr).toBe(0);
    expect(premier.stdout).toContain("Global deployment lock acquired");
    expect(second.stdout).toContain("Global deployment lock acquired");
    expect(await lireConfig(connectorId)).toEqual({ __secrets: ["apiKey"] });
    const lignes = await cible.query(
      "SELECT count(*)::int AS n FROM tenant_secrets",
    );
    expect(lignes.rows[0].n).toBe(1);
  });

  test("un CONNECTE legacy sans authMode devient ERREUR et conserve ses marqueurs", async () => {
    const clair = `legacy-connecte-${randomUUID()}`;
    const { connectorId } = await creerConnecteur(
      { apiKey: clair, dossier: "Compta" },
      { type: "PENNYLANE", status: "CONNECTE" },
    );

    const reprise = lancer();
    expect(reprise.status, reprise.stderr).toBe(0);
    expect(await lireConnecteur(connectorId)).toEqual({
      status: "ERREUR",
      config: {
        dossier: "Compta",
        reconnectRequired: true,
        __secrets: ["apiKey"],
      },
    });
  });

  test("BANQUE conserve son statut et son funnel sans authMode", async () => {
    const { connectorId } = await creerConnecteur(
      { bankConnectionId: "bridge-hosted-session" },
      { type: "BANQUE", status: "CONNECTE" },
    );

    const reprise = lancer();
    expect(reprise.status, reprise.stderr).toBe(0);
    expect(await lireConnecteur(connectorId)).toEqual({
      status: "CONNECTE",
      config: { bankConnectionId: "bridge-hosted-session" },
    });
  });

  test("une config OAuth moderne conserve tokenExpiresAt comme metadonnee publique", async () => {
    const config = {
      authMode: "OAUTH",
      tokenExpiresAt: "2026-09-30T12:00:00.000Z",
      accountLabel: "Compte Google Drive",
    };
    const { connectorId } = await creerConnecteur(config, {
      type: "GOOGLE_DRIVE",
      status: "CONNECTE",
    });

    const reprise = lancer();
    expect(reprise.status, reprise.stderr).toBe(0);
    expect(await lireConnecteur(connectorId)).toEqual({
      status: "CONNECTE",
      config,
    });
    const lignes = await cible.query(
      "SELECT count(*)::int AS n FROM tenant_secrets",
    );
    expect(lignes.rows[0].n).toBe(0);
  });

  test("la contrainte validee interdit toute nouvelle ecriture legacy en clair", async () => {
    const { connectorId } = await creerConnecteur({ dossier: "Archives" });
    const reprise = lancer();
    expect(reprise.status, reprise.stderr).toBe(0);
    await expect(
      cible.query(
        "UPDATE connectors SET config = jsonb_build_object('apiKey', 'interdit') WHERE id = $1",
        [connectorId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("le dry-run reconnait les cinq champs legacy sans modifier la base", async () => {
    const secrets = {
      apiKey: `api-${randomUUID()}`,
      secretKey: `secret-${randomUUID()}`,
      webhookSecret: `signature-${randomUUID()}`,
      clientSecret: `client-${randomUUID()}`,
      webhookUrl: `https://hooks.example.test/${randomUUID()}`,
    };
    const { connectorId } = await creerConnecteur({
      ...secrets,
      dossier: "Factures 2026",
    });

    const simulation = lancer("--dry-run");
    expect(simulation.status, simulation.stderr).toBe(0);
    expect(simulation.stdout).toContain("DRY-RUN");
    expect(await lireConfig(connectorId)).toEqual({
      ...secrets,
      dossier: "Factures 2026",
    });
    const lignes = await cible.query(
      "SELECT count(*)::int AS n FROM tenant_secrets",
    );
    expect(lignes.rows[0].n).toBe(0);
    for (const valeur of Object.values(secrets)) {
      expect(`${simulation.stdout}${simulation.stderr}`).not.toContain(valeur);
    }
  });

  test("deplace les cinq champs avec la bonne AAD, conserve le reste et est idempotent", async () => {
    const secrets = {
      apiKey: `api-${randomUUID()}`,
      secretKey: `secret-${randomUUID()}`,
      webhookSecret: `signature-${randomUUID()}`,
      clientSecret: `client-${randomUUID()}`,
      webhookUrl: `https://hooks.example.test/${randomUUID()}`,
    };
    const { tenantId, connectorId } = await creerConnecteur({
      ...secrets,
      dossier: "Factures",
    });

    const premier = lancer();
    expect(premier.status, premier.stderr).toBe(0);
    expect(await lireConfig(connectorId)).toEqual({
      dossier: "Factures",
      __secrets: Object.keys(secrets).sort(),
    });

    const { rows } = await cible.query(
      `SELECT cle, valeur_chiffree FROM tenant_secrets
       WHERE tenant_id = $1::uuid ORDER BY cle`,
      [tenantId],
    );
    expect(rows).toHaveLength(5);
    const chiffresAvant = rows.map((r) => [r.cle, r.valeur_chiffree]);
    for (const [champ, clair] of Object.entries(secrets)) {
      const cle = `connecteur.${connectorId}.${champ}`;
      const ligne = rows.find((r) => r.cle === cle);
      expect(ligne).toBeDefined();
      expect(dechiffrer(ligne.valeur_chiffree, { scope: tenantId, cle })).toBe(
        clair,
      );
    }

    const second = lancer();
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/connecteurs repris: 0/);
    const apres = await cible.query(
      "SELECT cle, valeur_chiffree FROM tenant_secrets WHERE tenant_id = $1::uuid ORDER BY cle",
      [tenantId],
    );
    expect(apres.rows.map((r) => [r.cle, r.valeur_chiffree])).toEqual(
      chiffresAvant,
    );
  });

  test("ne remplace jamais un secret deja chiffre par une valeur legacy differente", async () => {
    const clairExistant = `existant-${randomUUID()}`;
    const clairLegacy = `legacy-${randomUUID()}`;
    const { tenantId, connectorId } = await creerConnecteur({
      apiKey: clairLegacy,
    });
    const cle = `connecteur.${connectorId}.apiKey`;
    const chiffre = chiffrer(clairExistant, { scope: tenantId, cle });
    await cible.query(
      `INSERT INTO tenant_secrets (tenant_id, cle, valeur_chiffree, version_cle)
       VALUES ($1::uuid, $2, $3, $4)`,
      [tenantId, cle, chiffre.valeur, chiffre.versionCle],
    );

    const reprise = lancer();
    expect(reprise.status).not.toBe(0);
    expect(`${reprise.stdout}${reprise.stderr}`).not.toContain(clairExistant);
    expect(`${reprise.stdout}${reprise.stderr}`).not.toContain(clairLegacy);
    expect(await lireConfig(connectorId)).toEqual({ apiKey: clairLegacy });
    const { rows } = await cible.query(
      "SELECT valeur_chiffree FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle = $2",
      [tenantId, cle],
    );
    expect(rows[0].valeur_chiffree).toBe(chiffre.valeur);
  });

  test("repare l'AAD incorrecte ecrite par l'ancienne version sans perdre le clair", async () => {
    const clair = `recuperable-${randomUUID()}`;
    const { tenantId, connectorId } = await creerConnecteur({
      dossier: "Compta",
      __secrets: ["apiKey"],
    });
    const cle = `connecteur.${connectorId}.apiKey`;
    // L'ancien script passait `{ tenantId, cle }` a `chiffrer`; `scope`
    // devenait donc la chaine "undefined" dans l'AAD.
    const ancien = chiffrer(clair, { scope: "undefined", cle });
    await cible.query(
      `INSERT INTO tenant_secrets (tenant_id, cle, valeur_chiffree, version_cle)
       VALUES ($1::uuid, $2, $3, $4)`,
      [tenantId, cle, ancien.valeur, ancien.versionCle],
    );

    const reprise = lancer();
    expect(reprise.status, reprise.stderr).toBe(0);
    expect(await lireConfig(connectorId)).toEqual({
      dossier: "Compta",
      __secrets: ["apiKey"],
    });
    const { rows } = await cible.query(
      "SELECT valeur_chiffree FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle = $2",
      [tenantId, cle],
    );
    expect(dechiffrer(rows[0].valeur_chiffree, { scope: tenantId, cle })).toBe(
      clair,
    );
    expect(rows[0].valeur_chiffree).not.toBe(ancien.valeur);
  });

  test("echoue sans mutation si __secrets annonce une valeur absente", async () => {
    const { connectorId } = await creerConnecteur({
      dossier: "Compta",
      __secrets: ["webhookUrl"],
    });

    const reprise = lancer();
    expect(reprise.status).not.toBe(0);
    expect(await lireConfig(connectorId)).toEqual({
      dossier: "Compta",
      __secrets: ["webhookUrl"],
    });
    const lignes = await cible.query(
      "SELECT count(*)::int AS n FROM tenant_secrets",
    );
    expect(lignes.rows[0].n).toBe(0);
  });
});
