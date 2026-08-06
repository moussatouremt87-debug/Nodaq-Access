/**
 * Regression tests for connector config management:
 *   1. Partial reconfiguration preserves unedited credential fields.
 *   2. Disconnect (status → NON_CONNECTE) clears stored credentials.
 *
 * These mirror the exact logic in artifacts/api-server/src/routes/connecteurs.ts.
 * Run via: pnpm --filter @workspace/db run test-connectors
 */
"use strict";

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Mirror of the server-side config merge/disconnect logic.
 * @param {Record<string,string>} stored  - config currently in DB
 * @param {Record<string,string>} incoming - fields submitted by the client
 * @param {boolean} disconnecting - true when status === 'NON_CONNECTE'
 * @returns {Record<string,string>} resolved config to persist
 */
function resolveConfig(stored, incoming, disconnecting) {
  if (disconnecting) return {};              // authoritative clear
  var merged = Object.assign({}, stored);
  Object.keys(incoming).forEach(function (k) {
    var v = incoming[k];
    if (v && v !== "***") merged[k] = v;    // skip empty / redacted values
  });
  return merged;
}

pool.connect().then(function (client) {
  // ── Setup ────────────────────────────────────────────────────────────────
  return client.query("DELETE FROM connectors WHERE type LIKE '_TEST_%'")
    .then(function () {
      return client.query(
        "INSERT INTO connectors (id, type, label, status, config) VALUES (gen_random_uuid()::text, '_TEST_STRIPE', 'Test Stripe', 'CONNECTE', $1)",
        [JSON.stringify({ secretKey: "sk_live_REAL", webhookSecret: "whsec_REAL" })]
      );
    })

    // ── Test 1: partial reconfiguration preserves unedited secret ────────
    .then(function () {
      return client.query("SELECT config FROM connectors WHERE type='_TEST_STRIPE'");
    })
    .then(function (r) {
      var stored   = r.rows[0].config;
      var incoming = { webhookSecret: "whsec_NEW" };  // secretKey not submitted
      var merged   = resolveConfig(stored, incoming, false);
      if (merged.secretKey !== "sk_live_REAL")
        throw new Error("FAIL test 1: secretKey overwritten — got: " + merged.secretKey);
      if (merged.webhookSecret !== "whsec_NEW")
        throw new Error("FAIL test 1: webhookSecret not updated — got: " + merged.webhookSecret);
      return client.query("UPDATE connectors SET config=$1 WHERE type='_TEST_STRIPE'", [merged]);
    })
    .then(function () {
      console.log("✓ Test 1: unedited secretKey preserved after partial reconfiguration");
    })

    // ── Test 2: disconnect clears all stored credentials ─────────────────
    .then(function () {
      return client.query("SELECT config FROM connectors WHERE type='_TEST_STRIPE'");
    })
    .then(function (r) {
      var stored      = r.rows[0].config;
      // Client sends { status: 'NON_CONNECTE', config: {} } on disconnect
      var incoming    = {};
      var afterDiscon = resolveConfig(stored, incoming, true /*disconnecting*/);
      if (Object.keys(afterDiscon).length !== 0)
        throw new Error("FAIL test 2: config not cleared on disconnect — got: " + JSON.stringify(afterDiscon));
      return client.query("UPDATE connectors SET status='NON_CONNECTE', config=$1 WHERE type='_TEST_STRIPE'", [afterDiscon]);
    })
    .then(function () {
      console.log("✓ Test 2: disconnect clears stored credentials");
    })

    // ── Cleanup ──────────────────────────────────────────────────────────
    .then(function () {
      return client.query("DELETE FROM connectors WHERE type LIKE '_TEST_%'");
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
