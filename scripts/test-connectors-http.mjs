/**
 * HTTP-level regression tests for connector PATCH route.
 * Requires the API server running at TEST_API_BASE (default http://localhost:8080).
 *
 * Tests:
 *   1. Partial reconfiguration preserves unedited credential fields.
 *   2. Disconnect (status → NON_CONNECTE) clears all stored credentials.
 *
 * Env vars required: ADMIN_PASSWORD, DATABASE_URL
 */

const BASE = process.env.TEST_API_BASE ?? "http://localhost:8080";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TEST_TYPE = "_HTTP_TEST_STRIPE";

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is required");
  process.exit(1);
}

/** Authenticated session cookie */
let authCookie = "";

async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authCookie ? { Cookie: authCookie } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function waitReady(ms = 10_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error("API server not reachable after " + ms + "ms");
}

// ── Seed: ensure the test connector row exists via pg directly ─────────────
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function seedTestConnector() {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM connectors WHERE type = $1", [TEST_TYPE]);
    await client.query(
      "INSERT INTO connectors (id, type, label, status, config) VALUES (gen_random_uuid()::text, $1, 'HTTP Test Stripe', 'CONNECTE', $2)",
      [TEST_TYPE, JSON.stringify({ secretKey: "sk_live_REAL", webhookSecret: "whsec_REAL" })]
    );
  } finally {
    client.release();
  }
}

async function getStoredConfig() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT config FROM connectors WHERE type=$1", [TEST_TYPE]);
    return rows[0]?.config ?? null;
  } finally {
    client.release();
  }
}

async function cleanup() {
  const client = await pool.connect();
  try { await client.query("DELETE FROM connectors WHERE type=$1", [TEST_TYPE]); }
  finally { client.release(); await pool.end(); }
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    await waitReady();

    // Log in
    const loginRes = await api("POST", "/api/auth/login", { password: ADMIN_PASSWORD });
    if (loginRes.status !== 200) throw new Error("Login failed: " + JSON.stringify(loginRes.body));
    // node-fetch doesn't expose set-cookie easily; set auth header workaround below
    // Instead, use full curl-like approach with fetch and Replit's same-origin model
    // We need the cookie from the login response — use a jar approach
    const loginRaw = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    const setCookie = loginRaw.headers.get("set-cookie") ?? "";
    // Extract cookie name=value (before first ;)
    authCookie = setCookie.split(";")[0];
    if (!authCookie) throw new Error("No cookie received from login");

    await seedTestConnector();

    // ── Test 1: partial reconfiguration preserves unedited field ─────────
    const patchRes = await api("PATCH", `/api/connecteurs/${TEST_TYPE}`, {
      status: "CONNECTE",
      config: { webhookSecret: "whsec_NEW" }, // secretKey intentionally absent
    });
    if (patchRes.status !== 200) throw new Error("Test 1 PATCH failed: " + patchRes.status);
    const cfg1 = await getStoredConfig();
    if (cfg1?.secretKey !== "sk_live_REAL")
      throw new Error("FAIL Test 1: secretKey overwritten — got: " + cfg1?.secretKey);
    if (cfg1?.webhookSecret !== "whsec_NEW")
      throw new Error("FAIL Test 1: webhookSecret not updated — got: " + cfg1?.webhookSecret);
    console.log("✓ HTTP Test 1: partial reconfiguration preserves unedited secretKey");

    // ── Test 2: disconnect clears all stored credentials ─────────────────
    const disconnRes = await api("PATCH", `/api/connecteurs/${TEST_TYPE}`, {
      status: "NON_CONNECTE",
      config: {},
    });
    if (disconnRes.status !== 200)
      throw new Error("Test 2 PATCH failed: " + disconnRes.status);
    const cfg2 = await getStoredConfig();
    if (cfg2 === null || Object.keys(cfg2).length !== 0)
      throw new Error("FAIL Test 2: credentials not cleared — got: " + JSON.stringify(cfg2));
    console.log("✓ HTTP Test 2: disconnect clears stored credentials");

    await cleanup();
    console.log("✓ All HTTP connector regression tests passed");
  } catch (err) {
    console.error("HTTP test failed:", err.message);
    try { await cleanup(); } catch { /* best-effort */ }
    process.exit(1);
  }
})();
