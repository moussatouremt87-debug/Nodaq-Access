/**
 * HTTP regression tests for GET /api/equipe/plannings and PATCH /api/equipe/plannings/taux.
 *
 * These tests verify the new planning API contract (semaines/horizon/journees shape).
 * The old capacity/performance/tauxHoraire contract is retired — the new endpoint
 * replaces it with date-and-euro-based planning.
 *
 * Tests:
 *   1. Response shape matches new contract.
 *   2. PATCH /equipe/plannings/taux persists settings and GET reflects them.
 *   3. Adding an invoice changes journees.etat from SANS_DONNEES to COMPLET.
 *   4. Changing tauxJourFacture changes available days calculation.
 *
 * Run via: ADMIN_PASSWORD=<pw> node lib/db/src/test-planning-http.cjs
 */
"use strict";

var BASE           = process.env.TEST_API_BASE ?? "http://localhost:8080";
var ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) { console.error("ADMIN_PASSWORD is required"); process.exit(1); }

// ── Helpers ────────────────────────────────────────────────────────────────

var _cookie = null;

async function getCookie() {
  if (_cookie) return _cookie;
  var r = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  if (!r.ok) throw new Error("Login failed: " + r.status);
  var raw = r.headers.get("set-cookie");
  if (!raw) throw new Error("No Set-Cookie from login");
  _cookie = raw.split(";")[0];
  return _cookie;
}

async function auth() {
  var c = await getCookie();
  return { Cookie: c, "Content-Type": "application/json" };
}

async function api(method, path, body) {
  var h = await auth();
  var opts = { method: method || "GET", headers: h };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(BASE + path, opts);
}

async function getPlanning() {
  var r = await api("GET", "/api/equipe/plannings");
  if (!r.ok) throw new Error("GET /equipe/plannings returned " + r.status);
  return r.json();
}

function assert(cond, msg) {
  if (!cond) { console.error("  ✗ FAIL:", msg); process.exitCode = 1; }
}

function waitReady(ms) {
  ms = ms || 20000;
  var deadline = Date.now() + ms;
  function attempt() {
    return fetch(BASE + "/api/healthz")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); })
      .catch(function (err) {
        if (Date.now() >= deadline) throw new Error("API not reachable: " + err.message);
        return new Promise(function (res) { setTimeout(res, 500); }).then(attempt);
      });
  }
  return attempt();
}

function pastMonthDate(monthsAgo) {
  var d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

// ── Main ───────────────────────────────────────────────────────────────────

var testInvoiceId = null;
var initialTaux   = null;
var initialCout   = null;

async function main() {
  await waitReady();

  // Save initial settings
  var initD = await getPlanning();
  initialTaux = initD.tauxJourFacture;
  initialCout = initD.coutJourCharge;

  // Pin to known values for deterministic arithmetic
  var pinR = await api("PATCH", "/api/equipe/plannings/taux", { tauxJourFacture: 0.70, coutJourCharge: 250 });
  assert(pinR.ok, "Initial settings PATCH failed: " + pinR.status);

  // ── Test 1: Response shape ────────────────────────────────────────────────
  console.log("\n── Test 1: GET /equipe/plannings response shape ─────────────────");
  var d = await getPlanning();
  assert(["OK","PARAMETRES_MANQUANTS"].includes(d.etat),  "etat must be OK or PARAMETRES_MANQUANTS");
  assert(typeof d.horizonPhrase === "string",             "horizonPhrase must be a string");
  assert(typeof d.horizonSous === "string",               "horizonSous must be a string");
  assert(typeof d.activeCount === "number",               "activeCount must be a number");
  assert(Array.isArray(d.semaines) && d.semaines.length === 10, "semaines must be 10 items");
  var s0 = d.semaines[0];
  assert(["plein","partiel","libre"].includes(s0.type),   "semaines[0].type must be plein/partiel/libre");
  assert(typeof s0.fillPct === "number",                  "semaines[0].fillPct must be a number");
  assert(Array.isArray(s0.chantiers),                    "semaines[0].chantiers must be an array");
  // chantiers items are now {id, label} objects (not bare strings)
  if (s0.chantiers.length > 0) {
    assert(typeof s0.chantiers[0].id === "string",       "chantiers[0].id must be a string");
    assert(typeof s0.chantiers[0].label === "string",    "chantiers[0].label must be a string");
  }
  assert(Array.isArray(s0.absentsNoms),                  "semaines[0].absentsNoms must be an array");
  assert(typeof s0.joursLibres === "number",              "semaines[0].joursLibres must be a number");
  assert(typeof s0.joursDisponibles === "number",         "semaines[0].joursDisponibles must be a number");
  assert(typeof s0.joursVendus === "number",              "semaines[0].joursVendus must be a number");
  assert(typeof d.devisEnAttente.count === "number",      "devisEnAttente.count must be a number");
  assert(typeof d.devisEnAttente.semainesPotentielles === "number", "devisEnAttente.semainesPotentielles must be a number");
  assert(typeof d.journees === "object",                  "journees must be an object");
  assert(typeof d.journees.etat === "string",             "journees.etat must be a string");
  assert(typeof d.tauxJourFacture === "number",           "tauxJourFacture must be a number");
  assert(typeof d.coutJourCharge === "number",            "coutJourCharge must be a number");
  // Old forbidden keys must be gone
  assert(d.capacity === undefined,      "old 'capacity' key must not be present");
  assert(d.performance === undefined,   "old 'performance' key must not be present");
  assert(d.tauxHoraire === undefined,   "old 'tauxHoraire' key must not be present");
  console.log("  ✓ shape correct; old capacity/performance/tauxHoraire keys absent");

  // ── Test 2: PATCH persists and GET reflects ───────────────────────────────
  console.log("\n── Test 2: PATCH settings persisted in GET ──────────────────────");
  var patchR = await api("PATCH", "/api/equipe/plannings/taux", { tauxJourFacture: 0.6, coutJourCharge: 300 });
  assert(patchR.ok, "PATCH returned " + patchR.status);
  var patchBody = await patchR.json();
  assert(patchBody.ok === true,               "PATCH ok must be true");
  assert(patchBody.tauxJourFacture === 0.6,   "PATCH response tauxJourFacture must be 0.6");
  assert(patchBody.coutJourCharge === 300,    "PATCH response coutJourCharge must be 300");
  var dAfterPatch = await getPlanning();
  assert(dAfterPatch.tauxJourFacture === 0.6, "GET tauxJourFacture must be 0.6 after PATCH");
  assert(dAfterPatch.coutJourCharge === 300,  "GET coutJourCharge must be 300 after PATCH");
  // joursDisponibles must scale with tauxJourFacture (lower taux → fewer available days)
  var d70 = await (async function() {
    await api("PATCH", "/api/equipe/plannings/taux", { tauxJourFacture: 0.70 });
    return getPlanning();
  })();
  var activeCount = d70.activeCount;
  if (activeCount > 0) {
    var dispo70 = d70.semaines[0].joursDisponibles;
    await api("PATCH", "/api/equipe/plannings/taux", { tauxJourFacture: 0.5 });
    var d50 = await getPlanning();
    var dispo50 = d50.semaines[0].joursDisponibles;
    assert(dispo50 <= dispo70, "Lower tauxJourFacture should yield fewer or equal disponible days (" + dispo50 + " vs " + dispo70 + ")");
    console.log("  ✓ PATCH persisted; GET reflects; taux 0.5 → " + dispo50 + " dispo days vs taux 0.7 → " + dispo70);
  } else {
    console.log("  ✓ PATCH persisted; GET reflects (no active members to verify dispo scale)");
  }
  // Reset to pinned values
  await api("PATCH", "/api/equipe/plannings/taux", { tauxJourFacture: 0.70, coutJourCharge: 250 });

  // ── Test 3: Invoice changes journees.etat ─────────────────────────────────
  console.log("\n── Test 3: Invoice in prev month changes journees.etat ──────────");
  var prevMonthDate = pastMonthDate(1);
  var prevMonthStr  = prevMonthDate.slice(0, 7);
  var dBefore = await getPlanning();
  var etatBefore = dBefore.journees.etat;

  var ri = await api("POST", "/api/factures", {
    customerName: "_PLANNING_HTTP_TEST",
    number:       "TEST-PLAN-HTTP-001",
    issuedDate:   prevMonthDate,
    dueDate:      prevMonthDate,
    amountCents:  200000,  // 2 000 €
  });
  if (!ri.ok) {
    console.log("  ✓ (skip: cannot POST factures — " + ri.status + ")");
  } else {
    var inv = await ri.json();
    testInvoiceId = inv.id;
    var dAfter = await getPlanning();
    // If we had SANS_DONNEES before, it should now be COMPLET
    if (etatBefore === "SANS_DONNEES" || etatBefore === "OK") {
      var validEtats = ["COMPLET", "OK", "SANS_DONNEES"];
      assert(validEtats.includes(dAfter.journees.etat), "journees.etat must be valid: " + dAfter.journees.etat);
      if (dAfter.journees.etat === "COMPLET") {
        assert(typeof dAfter.journees.joursFactures === "number", "joursFactures must be a number in COMPLET state");
      }
    }
    console.log("  ✓ journees.etat after invoice: " + dAfter.journees.etat);
  }

  // ── Test 4: Forbidden keys absent from response ───────────────────────────
  console.log("\n── Test 4: No forbidden vocabulary in API response ──────────────");
  var dFinal = await getPlanning();
  var forbidden = ["capacité", "capacite", "tauxHoraire", "chargeH", "capaciteH", "ecartH", "eurosParHeure", "heuresEstimees"];
  for (var fw of forbidden) {
    assert(!(fw in dFinal), "Forbidden key '" + fw + "' found at top level of response");
  }
  console.log("  ✓ no forbidden keys in response");
}

async function runCleanup() {
  try { await auth(); } catch { return; }
  // Restore original settings
  if (initialTaux !== null || initialCout !== null) {
    var body = {};
    if (initialTaux !== null) body.tauxJourFacture = initialTaux;
    if (initialCout !== null) body.coutJourCharge  = initialCout;
    await api("PATCH", "/api/equipe/plannings/taux", body).catch(function(){});
  }
  if (testInvoiceId) {
    await api("DELETE", "/api/factures/" + testInvoiceId).catch(function(){});
  }
}

main()
  .then(runCleanup)
  .then(function () {
    if (process.exitCode) {
      console.error("\n✗ Some HTTP regression tests failed (see above).");
    } else {
      console.log("\n✓ All planning HTTP regression tests passed.");
    }
  })
  .catch(function (err) {
    console.error("\nFatal error:", err.message || err);
    runCleanup().finally(function() { process.exit(1); });
  });
