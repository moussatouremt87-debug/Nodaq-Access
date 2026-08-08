/**
 * Idempotent script — creates (or resets the password of) app_user and grants
 * it the minimum privileges needed to run the application.
 *
 * Run with the OWNER credentials (DATABASE_URL) — NEVER with DATABASE_URL_APP.
 *
 *   node lib/db/scripts/create-app-role.cjs
 *
 * The script prints a DATABASE_URL_APP value to stdout.
 * Copy it into the DATABASE_URL_APP Replit Secret.
 *
 * When to re-run: if the database is recreated or the app_user password is lost.
 *
 * NOTE: CREATE ROLE / ALTER ROLE are utility statements that PostgreSQL forbids
 * inside DO $$ ... $$ blocks.  They must be issued as standalone client.query()
 * calls, which is what this script does.
 */
"use strict";

const { Pool } = require("pg");
const crypto = require("crypto");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const password = crypto.randomBytes(24).toString("hex");

// Escape single-quotes in the generated password (defence-in-depth; the hex
// alphabet never produces them, but be explicit).
const safePw = password.replace(/'/g, "''");

ownerPool.connect().then(async (client) => {
  try {
    // 1. Check existence client-side — DO blocks cannot contain role DDL.
    const { rows } = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'app_user'",
    );
    const exists = rows.length > 0;

    // Explicit least-privilege attributes prevent a pre-existing role from
    // retaining superuser, createrole, createdb, or bypassrls privileges.
    const attrs = "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS";
    if (!exists) {
      await client.query(
        `CREATE ROLE app_user ${attrs} PASSWORD '${safePw}'`,
      );
      console.log("✓ app_user created");
    } else {
      await client.query(
        `ALTER ROLE app_user WITH ${attrs} PASSWORD '${safePw}'`,
      );
      console.log("✓ app_user password reset and attributes enforced");
    }

    // 2. Grant application-level privileges on existing objects.
    const grants = [
      `GRANT USAGE ON SCHEMA public TO app_user`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user`,
    ];
    for (const sql of grants) {
      await client.query(sql);
    }

    // 3. Ensure future objects (created by the owner during migrations) are
    //    automatically accessible to app_user.
    const defaults = [
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT USAGE, SELECT ON SEQUENCES TO app_user`,
    ];
    for (const sql of defaults) {
      await client.query(sql);
    }

    // 3bis. Re-assert append-only tables.
    //
    //  The blanket GRANT above (and the ALTER DEFAULT PRIVILEGES) re-grant
    //  UPDATE and DELETE on EVERY table, including the ones that must stay
    //  append-only. Migration 006 revokes them on archived_pdfs, but a later
    //  run of this script (password rotation, re-provisioning, a second
    //  environment) would silently restore them — and the legal immutability
    //  of archived invoices would be lost without any error.
    //
    //  This block is therefore the authoritative one: it runs last, and it is
    //  guarded by to_regclass so it is a no-op on a database where the table
    //  does not exist yet (first run, before migrations).
    const APPEND_ONLY_TABLES = ["archived_pdfs"];
    for (const table of APPEND_ONLY_TABLES) {
      const { rows } = await client.query(
        "SELECT to_regclass($1) IS NOT NULL AS present",
        [`public.${table}`],
      );
      if (rows[0]?.present) {
        await client.query(`REVOKE UPDATE, DELETE ON ${table} FROM app_user`);
        console.log(`✓ ${table}: append-only (UPDATE/DELETE revoked)`);
      }
    }

    console.log("✓ Grants applied");

    // 4. Build and print DATABASE_URL_APP.
    const appUrl = new URL(process.env.DATABASE_URL);
    appUrl.username = "app_user";
    appUrl.password = password;

    console.log("\nAdd this to your Replit Secrets as DATABASE_URL_APP:");
    console.log(appUrl.toString());
  } finally {
    client.release();
    await ownerPool.end();
  }
}).catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
