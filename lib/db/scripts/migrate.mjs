#!/usr/bin/env node
/**
 * NODAQ — versioned SQL migration runner
 *
 * Usage:
 *   node lib/db/scripts/migrate.mjs
 *
 * Required env:
 *   DATABASE_URL  — owner/superuser Postgres connection string (not DATABASE_URL_APP)
 *
 * What it does:
 *   1. Ensures a _migrations tracking table exists.
 *   2. Reads all *.sql files from lib/db/migrations/ in alphabetical order.
 *   3. Applies each file not yet recorded in _migrations, in one transaction.
 *   4. Records each applied file with its filename and timestamp.
 *   5. Exits with code 0 whether 0 or N migrations were applied (idempotent).
 *
 * Running twice on the same database is safe — the second run applies 0 migrations.
 */

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// MIGRATIONS_DIR resolution (in priority order):
//   1. MIGRATIONS_DIR env var — set in the Docker image so paths work regardless
//      of where migrate.mjs is copied inside the container.
//   2. Sibling "migrations/" directory relative to the script's parent dir
//      (development layout: lib/db/scripts/ → lib/db/migrations/).
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? path.resolve(__dirname, "..", "migrations");

// ── Config ────────────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "[migrate] ERROR: DATABASE_URL is required (owner/superuser credentials).",
  );
  console.error(
    "  export DATABASE_URL=postgres://owner:password@host:5432/dbname",
  );
  process.exit(1);
}

/*
 * Le TLS, sur les mêmes règles que l'application — mais REPRODUIT ici plutôt
 * qu'importé.
 *
 * Ce script tourne seul, avant que l'application n'existe : il est copié tel
 * quel dans l'image (`COPY … migrate.mjs`) et n'a pas accès aux paquets
 * compilés du dépôt. Une duplication de trente lignes vaut mieux qu'un import
 * qui casserait le seul outil capable de préparer la base.
 *
 * Voir `lib/db/src/tls.ts` pour le raisonnement complet, et les deux pièges
 * mesurés le 29/08/2026 : `sslmode=require` ne suffit pas contre un Postgres
 * géré, et se connecter par adresse IP casse la vérification.
 */
const caPem = (process.env.DATABASE_CA_PEM ?? "").trim();
let ssl;
if (caPem) {
  if (!caPem.includes("BEGIN CERTIFICATE")) {
    console.error(
      "[migrate] ERROR: DATABASE_CA_PEM ne ressemble pas à un certificat PEM.",
    );
    process.exit(1);
  }
  let hote = "";
  try {
    hote = new URL(connectionString).hostname;
  } catch {
    /* laissé vide */
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hote) || hote.includes(":")) {
    console.error(
      `[migrate] ERROR: la chaîne vise une ADRESSE IP (${hote}). SNI interdit les ` +
        "adresses : Node comparerait le certificat à « localhost ». Utilisez le nom DNS.",
    );
    process.exit(1);
  }
  ssl = { ca: caPem, rejectUnauthorized: true, servername: hote };
  console.log("[migrate] TLS vérifié (DATABASE_CA_PEM fournie).");
} else if (process.env.NODE_ENV === "production") {
  console.error(
    "[migrate] ERROR: DATABASE_CA_PEM absente et NODE_ENV=production — refus de " +
      "migrer EN CLAIR. `scw rdb instance get-certificate <instance-id>`.",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString, ...(ssl ? { ssl } : {}) });

// Cle de namespace Nodaq stable. Un verrou de SESSION, pas de transaction : il
// doit couvrir les migrations SQL ET le processus enfant de reprise.
const MIGRATION_LOCK_KEY = "4E4F4441514D4947";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          SERIAL      PRIMARY KEY,
      filename    TEXT        NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query(
    "SELECT filename FROM _migrations ORDER BY filename",
  );
  return new Set(rows.map((r) => r.filename));
}

async function listMigrationFiles() {
  let entries;
  try {
    entries = await fs.readdir(MIGRATIONS_DIR);
  } catch (err) {
    if (err.code === "ENOENT") {
      // A missing migrations directory is always a misconfiguration — exit fatally
      // rather than silently claiming "0 migrations applied".
      console.error(
        `[migrate] FATAL: Migrations directory not found: ${MIGRATIONS_DIR}`,
      );
      if (process.env.MIGRATIONS_DIR) {
        console.error(
          `  MIGRATIONS_DIR env var is set to: ${process.env.MIGRATIONS_DIR}`,
        );
        console.error(
          `  Ensure the directory exists inside the container/environment.`,
        );
      } else {
        console.error(
          `  Set MIGRATIONS_DIR env var to the directory containing *.sql files.`,
        );
        console.error(`  Docker example: -e MIGRATIONS_DIR=/app/migrations`);
      }
      process.exit(1);
    }
    throw err;
  }
  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.error(
      `[migrate] FATAL: Migrations directory is empty: ${MIGRATIONS_DIR}`,
    );
    console.error(`  Expected at least one *.sql file.`);
    process.exit(1);
  }
  return files; // alphabetical = 001 → 002 → … order
}

async function applyMigration(client, filename, sql) {
  // Run the SQL as-is inside its own transaction
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [
      filename,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("[migrate] Starting migration runner…");
  console.log(`[migrate] Migrations directory: ${MIGRATIONS_DIR}`);

  const files = await listMigrationFiles();
  if (files.length === 0) {
    console.log("[migrate] No migration files found.");
    return;
  }
  console.log(
    `[migrate] Found ${files.length} migration file(s): ${files.join(", ")}`,
  );

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log(
        "[migrate] ✓ All migrations already applied — nothing to do.",
      );
      return;
    }

    console.log(
      `[migrate] ${pending.length} migration(s) to apply: ${pending.join(", ")}`,
    );

    for (const filename of pending) {
      const filepath = path.join(MIGRATIONS_DIR, filename);
      const sql = await fs.readFile(filepath, "utf8");

      process.stdout.write(`[migrate] Applying ${filename}… `);
      const t0 = Date.now();
      await applyMigration(client, filename, sql);
      console.log(`✓ (${Date.now() - t0} ms)`);
    }

    console.log(
      `\n[migrate] ✓ Applied ${pending.length} migration(s) successfully.`,
    );
  } finally {
    client.release();
  }
}

/**
 * Les migrations SQL ne suffisent pas : les anciennes versions de l'interface
 * ont pu ranger des identifiants de connecteurs dans le JSON en clair. La
 * reprise exige le meme role owner que ce runner et doit donc faire partie de
 * CE chemin obligatoire, pas d'une commande a penser a lancer a cote.
 */
async function reprendreSecretsConnecteurs() {
  const script = path.resolve(__dirname, "migrate-connector-secrets.mjs");
  try {
    await fs.access(script);
  } catch {
    throw new Error(
      `Script obligatoire de reprise des connecteurs absent: ${script}`,
    );
  }

  console.log("[migrate] Starting mandatory connector-secrets recovery…");
  await new Promise((resolve, reject) => {
    const enfant = spawn(process.execPath, [script], {
      env: process.env,
      stdio: "inherit",
    });
    enfant.once("error", reject);
    enfant.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `Reprise des secrets de connecteurs echouee` +
              (signal ? ` (signal ${signal})` : ` (code ${code ?? "inconnu"})`),
          ),
        );
      }
    });
  });
  console.log("[migrate] ✓ Mandatory connector-secrets recovery verified.");
}

async function main() {
  const verrou = await pool.connect();
  let acquis = false;
  try {
    console.log("[migrate] Waiting for the global deployment lock…");
    await verrou.query(
      "SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)",
      [MIGRATION_LOCK_KEY],
    );
    acquis = true;
    console.log("[migrate] ✓ Global deployment lock acquired.");

    await run();
    await reprendreSecretsConnecteurs();
  } finally {
    if (acquis) {
      try {
        await verrou.query(
          "SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)",
          [MIGRATION_LOCK_KEY],
        );
      } catch {
        // Fermer la session libere de toute facon son advisory lock. Ne pas
        // masquer l'erreur de migration qui a conduit ici.
      }
    }
    verrou.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\n[migrate] FATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});
