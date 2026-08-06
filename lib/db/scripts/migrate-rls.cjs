/**
 * Phase 3 — RLS (Row-Level Security) migration.
 *
 * Idempotent — safe to run on a fresh or an already-migrated database.
 * Must be run with OWNER credentials (DATABASE_URL), not DATABASE_URL_APP.
 *
 *   node lib/db/scripts/migrate-rls.cjs
 *
 * For each of the 15 business tables, this script applies:
 *   - ENABLE ROW LEVEL SECURITY    (activate RLS on the table)
 *   - FORCE ROW LEVEL SECURITY     (applies even to the table owner)
 *   - Policy tenant_isolation:     USING  (tenant_id::text = current_setting(...))
 *                                  WITH CHECK (same predicate)
 *
 * Tables NOT receiving a tenant policy: tenants, users, memberships, sessions.
 *
 * The policy predicate uses a TEXT comparison to avoid cast errors when the
 * GUC is empty or unset:
 *   tenant_id::text = current_setting('app.current_tenant_id', true)
 * The second arg `true` returns NULL instead of raising when the GUC is absent.
 */
"use strict";

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BUSINESS_TABLES = [
  "affaires",
  "contrats",
  "factures",
  "prospects",
  "pending_actions",
  "chat_messages",
  "activity",
  "devis",
  "classeur_documents",
  "echeances",
  "team_members",
  "connectors",
  "settings",
  "cr_entries",
  "absences",
];

const POLICY_NAME = "tenant_isolation";

pool.connect().then(async (client) => {
  try {
    console.log("[Phase 3] Applying RLS to business tables…\n");

    for (const table of BUSINESS_TABLES) {
      // 1. Enable RLS
      await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);

      // 2. Force RLS (applies even to the table owner role)
      await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);

      // 3. Create / replace the tenant isolation policy
      //    DROP + CREATE is idempotent and keeps the policy definition current.
      await client.query(
        `DROP POLICY IF EXISTS ${POLICY_NAME} ON ${table}`,
      );
      await client.query(`
        CREATE POLICY ${POLICY_NAME} ON ${table}
          USING  (tenant_id::text = current_setting('app.current_tenant_id', true))
          WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true))
      `);

      console.log(`  ✓ ${table}`);
    }

    console.log("\n[Phase 3] RLS migration complete.");
  } catch (err) {
    console.error("\nRLS migration failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
});
