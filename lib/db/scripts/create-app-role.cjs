/**
 * Idempotent script — provisions app_user with the minimum privileges needed to
 * run the application, and (only when asked) rotates its password.
 *
 * Run with the OWNER credentials (DATABASE_URL) — NEVER with DATABASE_URL_APP.
 *
 *   node lib/db/scripts/create-app-role.cjs                     # safe, default
 *   node lib/db/scripts/create-app-role.cjs --rotate-password   # rotates
 *
 * ── DANGER: app_user is a CLUSTER-LEVEL role ────────────────────────────────
 * In PostgreSQL, roles belong to the instance, NOT to a database. A single
 * app_user is shared by every database of the cluster. Rotating its password
 * therefore affects ALL of them at once — including PRODUCTION, even when this
 * script is pointed at a throwaway test database. The running application keeps
 * its old password in DATABASE_URL_APP and starts failing authentication
 * immediately ("password authentication failed for user app_user").
 *
 * That is precisely why rotation is opt-in: this script used to reset the
 * password on every run, so a routine `pnpm db:setup` against a scratch
 * database silently cut production.
 *
 * ── The three paths ─────────────────────────────────────────────────────────
 *  1. Role ABSENT
 *     → created with a freshly generated password; the DATABASE_URL_APP
 *       connection string is printed. Nothing pre-existing can break.
 *
 *  2. Role PRESENT, no flag (default)
 *     → password left UNTOUCHED. Least-privilege attributes, grants and the
 *       append-only revocation are re-applied. No connection string is printed:
 *       the script does not know the current password, and inventing one would
 *       be worse than saying nothing. Safe to run against any database of a
 *       shared cluster, production included.
 *
 *  3. Role PRESENT, --rotate-password
 *     → password rotated and the new connection string printed. This is the
 *       ONLY path that can cut production, and it must be asked for explicitly.
 *       After rotating, update DATABASE_URL_APP everywhere the role is used.
 *
 * Verification runs on a blank database must never target the production
 * instance — see CLAUDE.md, "Pièges déjà rencontrés".
 *
 * NOTE: CREATE ROLE / ALTER ROLE are utility statements that PostgreSQL forbids
 * inside DO $$ ... $$ blocks.  They must be issued as standalone client.query()
 * calls, which is what this script does.
 */
"use strict";

const { Pool } = require("pg");
const crypto = require("crypto");

// ── CLI ───────────────────────────────────────────────────────────────────────

const ROTATE_FLAG = "--rotate-password";
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: node lib/db/scripts/create-app-role.cjs [${ROTATE_FLAG}]

  (no flag)           Provision app_user without touching an existing password.
                      Safe on a shared cluster, production included.

  ${ROTATE_FLAG}   Rotate the password and print the new connection string.
                      DANGER: app_user is a cluster-level role — this breaks
                      EVERY database of the instance until DATABASE_URL_APP is
                      updated, production included.

Requires DATABASE_URL (owner credentials).
`);
  process.exit(0);
}

// Reject unknown arguments rather than ignoring them: a typo such as
// "--rotate-passwords" must not be mistaken for a successful rotation.
const unknownArgs = args.filter((a) => a !== ROTATE_FLAG);
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  console.error(`Did you mean ${ROTATE_FLAG}? Run with --help for usage.`);
  process.exit(1);
}

const rotateRequested = args.includes(ROTATE_FLAG);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const password = crypto.randomBytes(24).toString("hex");

// Escape single-quotes in the generated password (defence-in-depth; the hex
// alphabet never produces them, but be explicit).
const safePw = password.replace(/'/g, "''");

/** Print the DATABASE_URL_APP connection string for the password we just set. */
function printConnectionString() {
  const appUrl = new URL(process.env.DATABASE_URL);
  appUrl.username = "app_user";
  appUrl.password = password;

  console.log("\nSet this as DATABASE_URL_APP:");
  console.log(appUrl.toString());
}

// Migration 002_rls.sql creates app_user with this password when the role does
// not exist yet — a value published in this repository. Keep in sync with that
// file. On the normal `pnpm db:setup` path the role is created by this script
// first, so the placeholder is never used; it only appears when migrations are
// applied on their own against a fresh database.
const MIGRATION_PLACEHOLDER_PASSWORD = "REPLACE_ME_run_create-app-role.cjs";

/**
 * Detect whether app_user still carries the published placeholder password, by
 * attempting to log in with it. PostgreSQL never reveals a stored password, so
 * probing is the only way to tell.
 *
 * Returns false on any failure other than a successful login (unreachable host,
 * pg_hba rejection, …): a false alarm would be worse than a missed one here,
 * and the surrounding warning still covers the case.
 */
async function placeholderPasswordIsLive() {
  const probeUrl = new URL(process.env.DATABASE_URL);
  probeUrl.username = "app_user";
  probeUrl.password = MIGRATION_PLACEHOLDER_PASSWORD;

  const probe = new Pool({
    connectionString: probeUrl.toString(),
    connectionTimeoutMillis: 5000,
    max: 1,
  });
  try {
    const client = await probe.connect();
    client.release();
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

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

    // `passwordChanged` drives whether a connection string is printed at the
    // end: printing one we cannot vouch for would be worse than printing none.
    let passwordChanged = false;

    // Set when the preserved password turns out to be the one published in
    // 002_rls.sql — checked after the connection is released, and turned into a
    // non-zero exit below.
    let placeholderIsLive = false;

    if (!exists) {
      // Path 1 — role absent: create it. Nothing pre-existing can break.
      await client.query(`CREATE ROLE app_user ${attrs} PASSWORD '${safePw}'`);
      passwordChanged = true;
      console.log("✓ app_user created with a generated password");
    } else if (rotateRequested) {
      // Path 3 — explicit rotation. The only path that can cut production.
      await client.query(`ALTER ROLE app_user WITH ${attrs} PASSWORD '${safePw}'`);
      passwordChanged = true;
      console.log("✓ app_user password ROTATED and attributes enforced");
    } else {
      // Path 2 — role exists, no flag: attributes only, password untouched.
      // Omitting the PASSWORD clause leaves the stored password intact.
      await client.query(`ALTER ROLE app_user WITH ${attrs}`);
      console.log("✓ app_user already exists — password PRESERVED, attributes enforced");
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
    // envois_journal : une trace d'envoi ne se réécrit pas. Sans cette entrée, le
    // GRANT massif ci-dessus lui rendrait UPDATE et DELETE au prochain
    // provisionnement, et l'append-only serait perdu sans aucune erreur.
    // Le GRANT massif ci-dessus rend les quatre droits : sans cette révocation,
    // chaque exécution de ce script DÉFERAIT en silence l'append-only posé par
    // les migrations. Toute nouvelle table append-only doit figurer ici.
    const APPEND_ONLY_TABLES = ["archived_pdfs", "envois_journal", "objectifs_franchissements", "paiements", "contact_bases", "oppositions", "incidents_facturation"];
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

    // 3ter. Re-assert no-delete tables — same reasoning as 3bis, but these
    // need UPDATE (tenant_invites.accepted_at is set on acceptance) and only
    // DELETE is structurally unused. A separate list because the blanket
    // REVOKE UPDATE, DELETE above would be too strong for these.
    const NO_DELETE_TABLES = ["tenant_invites"];
    for (const table of NO_DELETE_TABLES) {
      const { rows } = await client.query(
        "SELECT to_regclass($1) IS NOT NULL AS present",
        [`public.${table}`],
      );
      if (rows[0]?.present) {
        await client.query(`REVOKE DELETE ON ${table} FROM app_user`);
        console.log(`✓ ${table}: no-delete (DELETE revoked)`);
      }
    }

    console.log("✓ Grants applied");

    // 4. Report.
    if (passwordChanged) {
      printConnectionString();
      if (rotateRequested) {
        console.log(
          "\n⚠  app_user is a CLUSTER-level role: this rotation applies to EVERY\n" +
            "   database of this instance, production included. Update\n" +
            "   DATABASE_URL_APP everywhere the role is used, or the application\n" +
            "   will fail with 'password authentication failed for user app_user'.",
        );
      }
    } else {
      console.log(
        "\n⚠  The existing password was kept, so no connection string is printed —\n" +
          "   this script cannot read it back from PostgreSQL. Keep using the\n" +
          "   DATABASE_URL_APP you already have.\n" +
          "\n" +
          `   To rotate deliberately: node lib/db/scripts/create-app-role.cjs ${ROTATE_FLAG}\n` +
          "   Beware: app_user is a CLUSTER-level role — rotating affects EVERY\n" +
          "   database of this instance, production included.",
      );

      // Preserving the password is the safe default — EXCEPT when the password
      // being preserved is the one published in 002_rls.sql. Probe for it and
      // refuse to exit successfully, so this can never pass unnoticed.
      // We fail rather than rotate on our own: rotation stays opt-in (it is
      // cluster-wide), but a live public password must not look like success.
      placeholderIsLive = await placeholderPasswordIsLive();
    }

    return placeholderIsLive;
  } finally {
    client.release();
    await ownerPool.end();
  }
}).then((placeholderIsLive) => {
  if (!placeholderIsLive) return;

  console.error(
    "\n✗ REFUSED: app_user still accepts the placeholder password published in\n" +
      "  lib/db/migrations/002_rls.sql. The role was created by that migration,\n" +
      "  not by this script, so the run above preserved a PUBLIC password —\n" +
      "  anyone who can reach this database can log in as app_user.\n" +
      "\n" +
      "  Grants and attributes WERE applied; only the password is unresolved.\n" +
      "  Fix it now:\n" +
      `      node lib/db/scripts/create-app-role.cjs ${ROTATE_FLAG}\n` +
      "\n" +
      "  Rotation is not done automatically here: app_user is a CLUSTER-level\n" +
      "  role, so it must stay a deliberate act. But a live public password\n" +
      "  must never be reported as success.",
  );
  process.exit(1);
}).catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
