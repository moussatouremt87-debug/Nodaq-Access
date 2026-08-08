/**
 * Migration: add a narrow RLS policy on devis that allows SELECT by accept_token.
 *
 * This enables the public devis-acceptance flow to look up a row via its opaque
 * token (which IS the authorization credential) without bypassing RLS or exposing
 * owner credentials in the application runtime.
 *
 *   node lib/db/scripts/migrate-public-token-policy.cjs
 *
 * Must be run with OWNER credentials (DATABASE_URL).
 */
"use strict";

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.connect().then(async (client) => {
  try {
    console.log("[public-token] Adding narrow token-lookup RLS policy on devis…");

    // Allow app_user to SELECT a devis row when the session GUC
    // app.devis_accept_token matches the row's accept_token column.
    // This is a deliberately narrow policy: it grants read access only
    // when the token value is presented in the session, no GUC → no access.
    await client.query(`
      DROP POLICY IF EXISTS devis_public_token_lookup ON devis;
      CREATE POLICY devis_public_token_lookup ON devis
        FOR SELECT TO app_user
        USING (
          accept_token IS NOT NULL
          AND accept_token = current_setting('app.devis_accept_token', true)
        );
    `);

    console.log("  ✓ devis_public_token_lookup policy created");
    console.log("[public-token] Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
});
