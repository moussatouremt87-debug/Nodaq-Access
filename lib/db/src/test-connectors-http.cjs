/**
 * HTTP-level regression tests for the connector PATCH route.
 * Requires the API server to be running (default http://localhost:8080).
 *
 * Tests:
 *   1. Partial reconfiguration via PATCH preserves unedited credential fields in the DB.
 *   2. Disconnect (status → NON_CONNECTE) via PATCH clears all stored credentials.
 *
 * Run via: pnpm --filter @workspace/db run test-connectors-http
 */
"use strict";

const { Pool } = require("pg");

const BASE          = process.env.TEST_API_BASE   ?? "http://localhost:8080";
const TEST_EMAIL    = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const TEST_TYPE     = "_HTTP_TEST_STRIPE";

if (!TEST_EMAIL || !TEST_PASSWORD) { console.error("TEST_EMAIL and TEST_PASSWORD are required"); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Helpers ────────────────────────────────────────────────────────────────

function apiFetch(path, opts) {
  // global fetch is available in Node 18+
  return fetch(BASE + path, opts);
}

function waitReady(ms) {
  ms = ms || 15000;
  var deadline = Date.now() + ms;
  function attempt() {
    return fetch(BASE + "/api/healthz")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
      })
      .catch(function (err) {
        if (Date.now() >= deadline) throw new Error("API server not reachable after " + ms + "ms: " + err.message);
        return new Promise(function (res) { setTimeout(res, 500); }).then(attempt);
      });
  }
  return attempt();
}

function getStoredConfig(client) {
  return client.query("SELECT config FROM connectors WHERE type=$1", [TEST_TYPE])
    .then(function (r) { return r.rows[0] ? r.rows[0].config : null; });
}

// ── Main ───────────────────────────────────────────────────────────────────

var dbClient;
var authCookie = "";

waitReady()
  .then(function () {
    // Login — capture the set-cookie header
    return fetch(BASE + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
  })
  .then(function (loginRes) {
    if (!loginRes.ok) throw new Error("Login failed: HTTP " + loginRes.status);
    var setCookie = loginRes.headers.get("set-cookie") || "";
    authCookie = setCookie.split(";")[0]; // name=signedValue
    if (!authCookie) throw new Error("No auth cookie received after login");
    return pool.connect();
  })
  .then(function (client) {
    dbClient = client;
    // Seed a connected test connector with real credentials
    return dbClient.query("DELETE FROM connectors WHERE type=$1", [TEST_TYPE])
      .then(function () {
        return dbClient.query(
          "INSERT INTO connectors (id, type, label, status, config) " +
          "VALUES (gen_random_uuid()::text, $1, 'HTTP Test Stripe', 'CONNECTE', $2)",
          [TEST_TYPE, JSON.stringify({ secretKey: "sk_live_REAL", webhookSecret: "whsec_REAL" })]
        );
      });
  })

  // ── Test 1: partial reconfiguration preserves unedited secret ──────────
  .then(function () {
    return apiFetch("/api/connecteurs/" + TEST_TYPE, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: authCookie },
      body: JSON.stringify({ status: "CONNECTE", config: { webhookSecret: "whsec_NEW" } }),
    });
  })
  .then(function (r) {
    if (r.status !== 200) throw new Error("Test 1 PATCH returned HTTP " + r.status);
    return getStoredConfig(dbClient);
  })
  .then(function (cfg) {
    if (!cfg || cfg.secretKey !== "sk_live_REAL")
      throw new Error("FAIL Test 1: secretKey overwritten — got: " + (cfg && cfg.secretKey));
    if (!cfg || cfg.webhookSecret !== "whsec_NEW")
      throw new Error("FAIL Test 1: webhookSecret not updated — got: " + (cfg && cfg.webhookSecret));
    console.log("✓ HTTP Test 1: partial reconfiguration preserves unedited secretKey");
  })

  // ── Test 2: disconnect clears all stored credentials ───────────────────
  .then(function () {
    return apiFetch("/api/connecteurs/" + TEST_TYPE, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: authCookie },
      body: JSON.stringify({ status: "NON_CONNECTE", config: {} }),
    });
  })
  .then(function (r) {
    if (r.status !== 200) throw new Error("Test 2 PATCH returned HTTP " + r.status);
    return getStoredConfig(dbClient);
  })
  .then(function (cfg) {
    if (cfg === null || Object.keys(cfg).length !== 0)
      throw new Error("FAIL Test 2: credentials not cleared — got: " + JSON.stringify(cfg));
    console.log("✓ HTTP Test 2: disconnect clears stored credentials");
  })

  // ── Cleanup ─────────────────────────────────────────────────────────────
  .then(function () {
    return dbClient.query("DELETE FROM connectors WHERE type=$1", [TEST_TYPE]);
  })
  .then(function () {
    console.log("✓ All HTTP connector regression tests passed");
  })
  .catch(function (err) {
    console.error("HTTP test failed:", err.message);
    if (dbClient) {
      dbClient.query("DELETE FROM connectors WHERE type=$1", [TEST_TYPE]).catch(function () {});
    }
    process.exit(1);
  })
  .finally(function () {
    if (dbClient) dbClient.release();
    pool.end();
  });
