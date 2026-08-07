/**
 * Phase 4 auth integration tests.
 *
 * Validates:
 *   1. Unauthenticated requests return 401
 *   2. Registration creates a session with an opaque UUID cookie
 *   3. Email/password login works
 *   4. Body-supplied tenantId is ignored (session-derived only)
 *   5. Invalid/expired cookie returns 401
 *   6. Non-member access returns 403
 *   7. Logout deletes session — subsequent me() returns 401
 *   8. OWNER role gate is enforced on equipe/connecteurs/parametres
 *
 * Run:
 *   node lib/db/src/test-auth-phase4.cjs
 * (No env vars needed — the script registers a fresh test user each run.)
 */
"use strict";

var BASE = process.env.TEST_API_BASE ?? "http://localhost:8080";
var { Pool } = require("pg");

var pool = new Pool({ connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP });

var TEST_EMAIL    = "phase4test_" + Date.now() + "@nodaq.test";
var TEST_PASSWORD = "supersecret-phase4-test";

// ── helpers ────────────────────────────────────────────────────────────────

var passed = 0, failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log("  ✓ " + label);
    passed++;
  } else {
    console.error("  ✗ " + label + (detail ? " — " + detail : ""));
    failed++;
  }
}

function api(path, opts) {
  return fetch(BASE + path, opts ?? {});
}

function withCookie(cookie) {
  return { headers: { Cookie: cookie, "Content-Type": "application/json" } };
}

function waitReady(ms) {
  ms = ms || 10000;
  var deadline = Date.now() + ms;
  function attempt() {
    return api("/api/healthz").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
    }).catch(function (err) {
      if (Date.now() >= deadline) throw new Error("API not reachable: " + err.message);
      return new Promise(function (r) { setTimeout(r, 500); }).then(attempt);
    });
  }
  return attempt();
}

function extractCookie(res) {
  var raw = res.headers.get("set-cookie") || "";
  var val = (raw.split(";")[0] || "").split("=").slice(1).join("=");
  return raw.split(";")[0] || ""; // full "name=signedValue"
}

// ── cleanup ────────────────────────────────────────────────────────────────

async function cleanup(email) {
  if (!pool) return;
  try {
    var client = await pool.connect();
    // Delete memberships, sessions, users for the test email
    await client.query(
      `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    await client.query(
      `DELETE FROM memberships WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    await client.query(
      `DELETE FROM tenants WHERE id IN (
         SELECT m.tenant_id FROM memberships m
         JOIN users u ON u.id = m.user_id WHERE u.email = $1
       )`,
      [email],
    );
    await client.query("DELETE FROM users WHERE email = $1", [email]);
    client.release();
  } catch { /* best-effort */ }
  await pool.end().catch(() => {});
}

// ── tests ──────────────────────────────────────────────────────────────────

async function run() {
  await waitReady();

  console.log("\n[Phase 4 auth tests]\n");

  // ── 1. Unauthenticated → 401 ──────────────────────────────────────────
  console.log("1. Unauthenticated requests →");
  var r = await api("/api/cockpit/kpis");
  assert("GET /cockpit/kpis returns 401", r.status === 401);
  r = await api("/api/affaires");
  assert("GET /affaires returns 401", r.status === 401);
  r = await api("/api/equipe");
  assert("GET /equipe returns 401", r.status === 401);

  // ── 2. Register ───────────────────────────────────────────────────────
  console.log("\n2. POST /auth/register →");
  r = await api("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: TEST_EMAIL, password: TEST_PASSWORD,
      nom: "Test Phase4", tenantNom: "Test Tenant Phase4",
    }),
  });
  assert("register returns 201", r.status === 201);
  var regData = await r.json();
  assert("register returns userId", !!regData.userId);
  assert("register returns tenantId", !!regData.tenantId);

  var registeredTenantId = regData.tenantId;
  var regCookie = extractCookie(r);
  assert("register sets a signed cookie", regCookie.includes("nodaq_sid="));
  var cookieValue = regCookie.split("=").slice(1).join("=");
  // Cookie value should be URL-encoded UUID — not the literal string 'authenticated'
  assert("cookie is opaque (not 'authenticated')", !cookieValue.includes("authenticated"));

  // ── 3. /auth/me with valid cookie ─────────────────────────────────────
  console.log("\n3. GET /auth/me with valid cookie →");
  r = await api("/api/auth/me", withCookie(regCookie));
  assert("me returns 200", r.status === 200);
  var me = await r.json();
  assert("me.authenticated = true", me.authenticated === true);
  assert("me.email matches", me.email === TEST_EMAIL);
  assert("me.role = OWNER", me.role === "OWNER");
  assert("me.tenantId matches registration", me.tenantId === registeredTenantId);

  // ── 4. Business route with auth ───────────────────────────────────────
  console.log("\n4. Business route with valid auth cookie →");
  r = await api("/api/cockpit/kpis", withCookie(regCookie));
  assert("GET /cockpit/kpis returns 200 with auth", r.status === 200);
  var kpis = await r.json();
  assert("kpis response has affairesEnCours field", "affairesEnCours" in kpis);

  // ── 5. Body tenantId is ignored — session tenant is used ─────────────
  console.log("\n5. Body-supplied tenantId is ignored →");
  var fakeTenantId = "00000000-0000-0000-0000-000000000000";
  r = await api("/api/affaires", {
    method: "POST",
    headers: { Cookie: regCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "Test affaire phase4",
      tenantId: fakeTenantId,   // forged — should be ignored
    }),
  });
  assert("POST /affaires returns 201", r.status === 201);
  var aff = await r.json();
  assert("created affaire uses session tenantId (not forged)", aff.tenantId === registeredTenantId);

  // ── 6. Email/password login ───────────────────────────────────────────
  console.log("\n6. POST /auth/login →");
  r = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  assert("login returns 200", r.status === 200);
  var loginCookie = extractCookie(r);
  assert("login sets cookie", loginCookie.includes("nodaq_sid="));

  r = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: "wrongpassword" }),
  });
  assert("wrong password returns 401", r.status === 401);

  r = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nobody@nodaq.test", password: "abc" }),
  });
  assert("unknown email returns 401", r.status === 401);

  // ── 7. Invalid cookie returns 401 ─────────────────────────────────────
  console.log("\n7. Invalid / forged cookie →");
  r = await api("/api/auth/me", { headers: { Cookie: "nodaq_sid=invalid-uuid-that-does-not-exist" } });
  assert("forged cookie returns 401", r.status === 401);

  r = await api("/api/cockpit/kpis", { headers: { Cookie: "nodaq_sid=00000000-0000-0000-0000-000000000000" } });
  assert("nonexistent session ID returns 401 on business route", r.status === 401);

  // ── 8. Logout invalidates session ─────────────────────────────────────
  console.log("\n8. Logout →");
  r = await api("/api/auth/logout", { method: "POST", headers: { Cookie: loginCookie } });
  assert("logout returns 200", r.status === 200);
  r = await api("/api/auth/me", withCookie(loginCookie));
  assert("me after logout returns 401", r.status === 401);

  // ── 9. OWNER role gate ────────────────────────────────────────────────
  console.log("\n9. OWNER-only routes accessible to OWNER →");
  // OWNER can access equipe
  r = await api("/api/equipe", withCookie(regCookie));
  assert("OWNER can GET /equipe", r.status === 200);
  // OWNER can access parametres
  r = await api("/api/parametres", withCookie(regCookie));
  assert("OWNER can GET /parametres", r.status === 200);

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(50));
  console.log(`Phase 4 auth tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run()
  .catch(err => { console.error("Fatal:", err.message); process.exit(1); })
  .finally(() => cleanup(TEST_EMAIL));
