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

    // ── Phase 3b — Narrow public-token policy on devis ───────────────────────
    // Allows app_user to SELECT a single devis row when the session GUC
    // app.devis_accept_token matches the row's accept_token column.
    // This enables the unauthenticated acceptance flow without bypassing RLS.
    console.log("\n[Phase 3b] Adding devis public-token lookup policy…");
    await client.query(`
      DROP POLICY IF EXISTS devis_public_token_lookup ON devis;
      CREATE POLICY devis_public_token_lookup ON devis
        FOR SELECT TO app_user
        USING (
          accept_token IS NOT NULL
          AND accept_token = current_setting('app.devis_accept_token', true)
        );
    `);
    console.log("  ✓ devis_public_token_lookup");

    // ── Phase 3c — analytics_tool_logs (migration 004) ───────────────────────
    // Idempotent: CREATE TABLE IF NOT EXISTS + DROP/CREATE policy.
    console.log("\n[Phase 3c] Creating analytics_tool_logs table + RLS…");
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_tool_logs (
        id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id        uuid        NOT NULL REFERENCES tenants(id),
        indicateur_id    text        NOT NULL,
        periode_debut    date,
        periode_fin      date,
        comparaison_mode text,
        duration_ms      integer     NOT NULL DEFAULT 0,
        status           text        NOT NULL
          CHECK (status IN ('ok', 'insuffisantes', 'erreur')),
        created_at       timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS analytics_tool_logs_tenant_created
        ON analytics_tool_logs (tenant_id, created_at DESC)
    `);
    await client.query(`ALTER TABLE analytics_tool_logs ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE analytics_tool_logs FORCE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS tenant_isolation ON analytics_tool_logs`);
    await client.query(`
      CREATE POLICY tenant_isolation ON analytics_tool_logs
        USING      (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
        WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    `);
    await client.query(`GRANT SELECT, INSERT ON analytics_tool_logs TO app_user`);
    console.log("  ✓ analytics_tool_logs");

  } catch (err) {
    console.error("\nRLS migration failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
});
