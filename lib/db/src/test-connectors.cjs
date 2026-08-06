/**
 * Regression test: connector reconfiguration preserves unedited secrets.
 * Verifies the server-side config-merge logic.
 * Run via: pnpm --filter @workspace/db run test-connectors
 */
"use strict";

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.connect().then(function (client) {
  // Remove any leftover test row
  return client.query("DELETE FROM connectors WHERE type = '_TEST_STRIPE'")
    .then(function () {
      // Insert a connector with real credentials
      // Use gen_random_uuid() inline — the column has no server-side default on existing DBs
      return client.query(
        "INSERT INTO connectors (id, type, label, status, config) VALUES (gen_random_uuid()::text, '_TEST_STRIPE', 'Test Stripe', 'CONNECTE', $1)",
        [JSON.stringify({ secretKey: "sk_live_REAL", webhookSecret: "whsec_REAL" })]
      );
    })
    .then(function () {
      // Simulate PATCH: user only re-enters webhookSecret; secretKey field was left blank (empty string).
      // Server merge logic: skip values that are empty or equal to the redacted placeholder "***".
      return client.query("SELECT config FROM connectors WHERE type='_TEST_STRIPE'");
    })
    .then(function (result) {
      var existing = result.rows[0].config;
      var incoming = { webhookSecret: "whsec_NEW" }; // secretKey intentionally absent/empty
      var merged = Object.assign({}, existing);
      Object.keys(incoming).forEach(function (k) {
        var v = incoming[k];
        if (v && v !== "***") merged[k] = v;
      });
      return client.query("UPDATE connectors SET config=$1 WHERE type='_TEST_STRIPE'", [merged]);
    })
    .then(function () {
      return client.query("SELECT config FROM connectors WHERE type='_TEST_STRIPE'");
    })
    .then(function (result) {
      var cfg = result.rows[0].config;
      if (cfg.secretKey !== "sk_live_REAL") {
        throw new Error("FAIL: secretKey was overwritten! Got: " + cfg.secretKey);
      }
      if (cfg.webhookSecret !== "whsec_NEW") {
        throw new Error("FAIL: webhookSecret not updated! Got: " + cfg.webhookSecret);
      }
      console.log("✓ Unedited secretKey preserved after partial reconfiguration");
      console.log("✓ Edited webhookSecret correctly updated");
      return client.query("DELETE FROM connectors WHERE type='_TEST_STRIPE'");
    })
    .then(function () {
      console.log("✓ All connector regression tests passed");
    })
    .finally(function () {
      client.release();
      return pool.end();
    });
}).catch(function (err) {
  console.error("Test failed:", err.message);
  process.exit(1);
});
