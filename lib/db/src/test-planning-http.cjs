/**
 * HTTP-level regression tests for GET /api/equipe/plannings and
 * PATCH /api/equipe/plannings/taux.
 *
 * Calculation contract (mirrors backend buildPlanningData):
 *   - amountCents stored as cents (e.g. 1 200 000 c = 12 000 €).
 *   - monthlyRevenueCents(amountCents, cadence): cents adjusted for cadence.
 *   - chargeH = totalMonthlyContractCents / (tauxHoraire * 100)
 *   - caRealise: facture amountCents summed per YYYY-MM of issuedDate, then ÷ 100 (display euros).
 *   - eurosParHeure = caRealise / heuresEstimees.
 *
 * Tests:
 *   1. Response shape is correct.
 *   2. Zero active members → capaciteH === 0 (no false floor).
 *   3. Active contract contributes exact hours to chargeH (120h for 12 000 €/month at 100 €/h).
 *   4. Invoice in a past month appears in caRealise and eurosParHeure derives correctly.
 *   5. Changing tauxHoraire alters chargeH from raw cents (PATCH + GET agree).
 *
 * Run via: pnpm --filter @workspace/db run test-planning-http
 */
"use strict";

var BASE           = process.env.TEST_API_BASE  ?? "http://localhost:8080";
var ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) { console.error("ADMIN_PASSWORD is required"); process.exit(1); }

// ── Helpers ────────────────────────────────────────────────────────────────

function apiFetch(path, opts) {
  return fetch(BASE + path, opts);
}

async function getCookie() {
  var r = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  if (!r.ok) throw new Error("Login failed: " + r.status);
  var raw = r.headers.get("set-cookie");
  if (!raw) throw new Error("No Set-Cookie from login");
  return raw.split(";")[0];
}

function waitReady(ms) {
  ms = ms || 15000;
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

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
}

async function getPlanning(authH) {
  var r = await apiFetch("/api/equipe/plannings", { headers: authH });
  assert(r.ok, "GET /equipe/plannings returned " + r.status);
  return r.json();
}

/**
 * Monthly revenue in cents — mirrors backend monthlyRevenueCents.
 */
function monthlyRevenueCents(amountCents, cadence) {
  var c = amountCents ?? 0;
  if (cadence === "mensuel")     return c;
  if (cadence === "trimestriel") return c / 3;
  if (cadence === "semestriel")  return c / 6;
  if (cadence === "annuel")      return c / 12;
  return c;
}

/**
 * Return a YYYY-MM-DD date string for `monthsAgo` months before today
 * (always the first day of that month).
 */
function pastMonthDate(monthsAgo) {
  var d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  await waitReady();
  var cookie = await getCookie();
  var authH = { Cookie: cookie, "Content-Type": "application/json" };

  // Track created resources for cleanup
  var testContractId = null;
  var testInvoiceId  = null;
  var initialTaux    = 60;

  try {
    // ── Test 1: Response shape ──────────────────────────────────────────
    var d = await getPlanning(authH);
    initialTaux = d.tauxHoraire;
    assert(Array.isArray(d.capacity)    && d.capacity.length    === 6, "capacity must have 6 months");
    assert(Array.isArray(d.performance) && d.performance.length === 6, "performance must have 6 months");
    assert(typeof d.tauxHoraire === "number", "tauxHoraire must be a number");
    var c0 = d.capacity[0];
    assert(typeof c0.capaciteH === "number", "capacity[0].capaciteH must be a number");
    assert(typeof c0.chargeH   === "number", "capacity[0].chargeH must be a number");
    assert(typeof c0.ecartH    === "number", "capacity[0].ecartH must be a number");
    assert(typeof c0.verdict   === "string", "capacity[0].verdict must be a string");
    var p0 = d.performance[0];
    assert(typeof p0.caRealise      === "number", "performance[0].caRealise must be a number");
    assert(typeof p0.heuresEstimees === "number", "performance[0].heuresEstimees must be a number");
    assert(typeof p0.verdict        === "string",  "performance[0].verdict must be a string");
    console.log("✓ Test 1: GET /equipe/plannings returns correct shape");

    // ── Test 2: Zero active members → zero capaciteH ───────────────────
    var membersR = await apiFetch("/api/equipe", { headers: authH });
    assert(membersR.ok, "GET /equipe returned " + membersR.status);
    var members = await membersR.json();
    var nonAbsent = members.filter(function (m) { return m.availability !== "ABSENT"; });

    for (var m of nonAbsent) {
      var pr = await apiFetch("/api/equipe/" + m.id, {
        method: "PATCH", headers: authH,
        body: JSON.stringify({ availability: "ABSENT" }),
      });
      assert(pr.ok, "PATCH member ABSENT returned " + pr.status);
    }

    var dZero = await getPlanning(authH);
    assert(
      dZero.capacity.every(function (row) { return row.capaciteH === 0; }),
      "capaciteH must be 0 when all members ABSENT, got " + dZero.capacity[0].capaciteH,
    );

    for (var m of nonAbsent) {
      await apiFetch("/api/equipe/" + m.id, {
        method: "PATCH", headers: authH,
        body: JSON.stringify({ availability: m.availability }),
      });
    }
    console.log("✓ Test 2: Zero active members → zero capaciteH");

    // ── Test 2b: N active members → capaciteH === N × 151 ──────────────
    var dRestored = await getPlanning(authH);
    var restoredMembersR = await apiFetch("/api/equipe", { headers: authH });
    assert(restoredMembersR.ok, "GET /equipe returned " + restoredMembersR.status);
    var restoredMembers = await restoredMembersR.json();
    var activeCount = restoredMembers.filter(function (m) { return m.availability !== "ABSENT"; }).length;
    var expectedCapaciteH = activeCount * 151;
    assert(
      dRestored.capacity[0].capaciteH === expectedCapaciteH,
      "capaciteH should be " + activeCount + " × 151 = " + expectedCapaciteH + ", got " + dRestored.capacity[0].capaciteH,
    );
    assert(
      dRestored.capacity.every(function (row) { return row.capaciteH === expectedCapaciteH; }),
      "All 6 capacity rows must report the same capaciteH (" + expectedCapaciteH + ")",
    );
    console.log("✓ Test 2b: " + activeCount + " active member(s) → capaciteH === " + expectedCapaciteH + " (= " + activeCount + " × 151)");

    // ── Test 3: Active contract → exact chargeH from cents formula ──────
    // Pin tauxHoraire to 100 for clean arithmetic
    var knownTaux = 100;
    await apiFetch("/api/equipe/plannings/taux", {
      method: "PATCH", headers: authH, body: JSON.stringify({ tauxHoraire: knownTaux }),
    });

    var dBase = await getPlanning(authH);
    var baseChargeH = dBase.capacity[0].chargeH;

    // 12 000 € mensuel = 1 200 000 cents; at 100 €/h → 1 200 000 / (100 × 100) = 120 h
    var contractAmountCents = 1200000;
    var contractCadence     = "mensuel";
    var expectedExtraH      = Math.round(monthlyRevenueCents(contractAmountCents, contractCadence) / (knownTaux * 100));
    assert(expectedExtraH === 120, "sanity: 12 000€ at 100€/h should be 120h, got " + expectedExtraH);

    var rc = await apiFetch("/api/contrats", {
      method: "POST", headers: authH,
      body: JSON.stringify({
        label:       "_HTTP_PLANNING_TEST",
        clientName:  "Test Client",
        cadence:     contractCadence,
        amountCents: contractAmountCents,
        startDate:   new Date().toISOString().slice(0, 10),
        status:      "ACTIF",
      }),
    });
    assert(rc.ok, "POST /contrats returned " + rc.status);
    var newContract = await rc.json();
    testContractId = newContract.id;
    assert(typeof testContractId === "string", "Created contract must have an id");

    var dWithContract = await getPlanning(authH);
    var actualCharge = dWithContract.capacity[0].chargeH;
    assert(
      actualCharge === baseChargeH + expectedExtraH,
      "chargeH should increase by " + expectedExtraH + "h " +
      "(1 200 000 c / (100 × 100)). Was " + baseChargeH + " now " + actualCharge,
    );
    console.log("✓ Test 3: Active contract contributes exact hours to chargeH (120h for 12 000€/month at 100€/h)");

    // ── Test 4: Invoice in a past month appears in caRealise ────────────
    // Use month -3 (3 months ago) — always within the past-6-months window
    var pastDate = pastMonthDate(3);          // first day of 3 months ago
    var pastMois = pastDate.slice(0, 7);      // "YYYY-MM"

    // Find the matching performance row before adding the invoice
    var dBeforeInv = await getPlanning(authH);
    var perfBefore = dBeforeInv.performance.find(function (row) { return row.mois === pastMois; });
    assert(perfBefore !== undefined, "Month " + pastMois + " must be in the past-6-months window");
    var caBefore = perfBefore.caRealise;

    // Add a 6 000 € invoice for that past month (600 000 cents)
    var invoiceAmountCents = 600000; // 6 000 €
    var ri = await apiFetch("/api/factures", {
      method: "POST", headers: authH,
      body: JSON.stringify({
        customerName: "_PLANNING_TEST",
        number:       "TEST-PLAN-001",
        issuedDate:   pastDate,
        dueDate:      pastDate,
        amountCents:  invoiceAmountCents,
      }),
    });
    assert(ri.ok, "POST /factures returned " + ri.status);
    var newInvoice = await ri.json();
    testInvoiceId = newInvoice.id;
    assert(typeof testInvoiceId === "string", "Created invoice must have an id");

    var dWithInv = await getPlanning(authH);
    var perfAfter = dWithInv.performance.find(function (row) { return row.mois === pastMois; });
    assert(perfAfter !== undefined, "Month " + pastMois + " must still be in window after invoice");

    var expectedCAIncrease = Math.round(invoiceAmountCents / 100); // 6 000 €
    assert(
      perfAfter.caRealise === caBefore + expectedCAIncrease,
      "caRealise for " + pastMois + " should increase by " + expectedCAIncrease +
      "€ (600 000 c ÷ 100). Was " + caBefore + " now " + perfAfter.caRealise,
    );

    // eurosParHeure must equal Math.round(caRealise / heuresEstimees) when heures > 0
    if (perfAfter.heuresEstimees > 0) {
      var expectedEPH = Math.round(perfAfter.caRealise / perfAfter.heuresEstimees);
      assert(
        perfAfter.eurosParHeure === expectedEPH,
        "eurosParHeure = caRealise/heuresEstimees = " + expectedEPH + ", got " + perfAfter.eurosParHeure,
      );
    }
    console.log("✓ Test 4: Invoice caRealise increases correctly (" + expectedCAIncrease + "€ in " + pastMois + "); eurosParHeure derives correctly");

    // ── Test 5: Changing tauxHoraire alters chargeH from raw cents ──────
    var newTaux = knownTaux * 2; // 200 €/h

    // Fetch active contracts to compute expected chargeH from raw cents
    var contratsR = await apiFetch("/api/contrats", { headers: authH });
    assert(contratsR.ok, "GET /contrats returned " + contratsR.status);
    var contratsBody = await contratsR.json();
    // Defensive: handle both plain array and { contrats: [...] } shapes
    var allContrats = Array.isArray(contratsBody) ? contratsBody : (contratsBody.contrats ?? []);
    var activeContrats = allContrats.filter(function (c) { return c.status === "ACTIF"; });
    var totalMonthCents = activeContrats.reduce(function (sum, c) {
      return sum + monthlyRevenueCents(c.amountCents ?? 0, c.cadence);
    }, 0);
    var expectedChargeAtNewTaux = Math.round(totalMonthCents / (newTaux * 100));

    var r5 = await apiFetch("/api/equipe/plannings/taux", {
      method: "PATCH", headers: authH, body: JSON.stringify({ tauxHoraire: newTaux }),
    });
    assert(r5.ok, "PATCH /equipe/plannings/taux returned " + r5.status);
    var d5 = await r5.json();
    assert(d5.tauxHoraire === newTaux, "PATCH tauxHoraire should be " + newTaux + ", got " + d5.tauxHoraire);
    assert(Array.isArray(d5.capacity), "PATCH response must include capacity array");
    assert(
      d5.capacity[0].chargeH === expectedChargeAtNewTaux,
      "PATCH chargeH: expected " + expectedChargeAtNewTaux + " (cents/(newTaux×100)), got " + d5.capacity[0].chargeH,
    );

    // Verify GET reflects same value
    var dAfter = await getPlanning(authH);
    assert(dAfter.tauxHoraire === newTaux, "GET tauxHoraire should be " + newTaux + ", got " + dAfter.tauxHoraire);
    assert(
      dAfter.capacity[0].chargeH === expectedChargeAtNewTaux,
      "GET chargeH after rate change: expected " + expectedChargeAtNewTaux + " got " + dAfter.capacity[0].chargeH,
    );
    console.log("✓ Test 5: Changing tauxHoraire alters chargeH correctly (raw cents / (taux×100), PATCH and GET agree)");

  } finally {
    // ── Cleanup: always restore original state ─────────────────────────
    // Restore tauxHoraire
    await apiFetch("/api/equipe/plannings/taux", {
      method: "PATCH", headers: authH, body: JSON.stringify({ tauxHoraire: initialTaux }),
    }).catch(function () {});

    // Deactivate test contract
    if (testContractId) {
      await apiFetch("/api/contrats/" + testContractId, {
        method: "PATCH", headers: authH, body: JSON.stringify({ status: "TERMINE" }),
      }).catch(function () {});
    }

    // DELETE test invoice (settled invoices still affect CA — must remove)
    if (testInvoiceId) {
      await apiFetch("/api/factures/" + testInvoiceId, {
        method: "DELETE", headers: authH,
      }).catch(function () {});
    }
  }

  console.log("✓ All HTTP planning regression tests passed");
}

main().catch(function (err) {
  console.error("Planning HTTP test error:", err.message || err);
  process.exit(1);
});
