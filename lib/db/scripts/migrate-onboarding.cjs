/**
 * Onboarding schema migration (tickets 4.8 + 4.9).
 *
 * Idempotent — safe to run on fresh or migrated databases.
 * Run with OWNER credentials (DATABASE_URL).
 *
 *   node lib/db/scripts/migrate-onboarding.cjs
 *
 * Adds columns:
 *   team_members : type_lien, jours_par_semaine, cout_mensuel_charge
 *   affaires     : montant_vendu_ht, avancement_pct, date_fin_prevue, origine
 */
"use strict";

const { Pool } = require("pg");

// Prefer the owner/superuser URL (required for DDL), fall back to app URL
// if an operator has granted the app role ALTER TABLE privileges.
// DATABASE_URL  — owner credentials (always works for DDL)
// DATABASE_URL_APP — app_user credentials (works only if role has ALTER rights)
const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP;
if (!connectionString) {
  console.error("Neither DATABASE_URL nor DATABASE_URL_APP is set");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.warn("[onboarding-migration] DATABASE_URL not found; falling back to DATABASE_URL_APP — ALTER TABLE may fail if the role lacks DDL privileges.");
}

const pool = new Pool({ connectionString });

async function colExists(client, table, col) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, col],
  );
  return rows.length > 0;
}

async function addColIfMissing(client, table, col, definition) {
  if (!(await colExists(client, table, col))) {
    await client.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
    console.log(`  + ${table}.${col} added`);
  } else {
    console.log(`  ~ ${table}.${col} already exists`);
  }
}

pool.connect().then(async (client) => {
  try {
    console.log("\n[Onboarding] Migrating team_members…");
    await addColIfMissing(client, "team_members", "type_lien", "TEXT NOT NULL DEFAULT 'SALARIE'");
    await addColIfMissing(client, "team_members", "jours_par_semaine", "REAL NOT NULL DEFAULT 5");
    await addColIfMissing(client, "team_members", "cout_mensuel_charge", "REAL");

    console.log("\n[Onboarding] Migrating affaires…");
    await addColIfMissing(client, "affaires", "montant_vendu_ht", "REAL");
    await addColIfMissing(client, "affaires", "avancement_pct", "REAL");
    await addColIfMissing(client, "affaires", "date_fin_prevue", "TEXT");
    await addColIfMissing(client, "affaires", "origine", "TEXT");

    console.log("\n✓ Onboarding migration complete");
  } catch (err) {
    console.error("\nMigration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
});
