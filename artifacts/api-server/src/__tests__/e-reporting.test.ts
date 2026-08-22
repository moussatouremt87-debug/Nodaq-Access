/**
 * E-reporting (US-A2.6) — agrégation du ledger, exclusion des factures hors
 * champ (brouillon/avoir/annulée), isolation multi-tenant, et refus explicite
 * (503) tant qu'aucune plateforme agréée n'est configurée sur ce déploiement.
 *
 * Pas de test de transmission réussie ici : aucune PA n'est contractée à ce
 * jour (PA_BASE_URL/PA_API_KEY absentes dans tout environnement de test),
 * donc POST /e-reporting/declarer ne peut légitimement que 503.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  adminPool,
  createTestTenant,
  createTestUser,
  createTestMembership,
  createTestSession,
  cookieHeader,
  cleanupTenants,
  cleanupUsers,
  serveurTest,
} from "./helpers";

let cookieA: string;
let cookieB: string;
let tenantAId: string;
let tenantBId: string;
const tenantIds: string[] = [];
const emails: string[] = [];

async function createBrouillon(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await request(serveurTest(app))
    .post("/api/factures")
    .set("Cookie", cookie)
    .send({
      customerName: "Client E-Reporting",
      issuedDate: "2026-08-05",
      dueDate: "2026-09-05",
      lines: [{ description: "Prestation", quantity: 1, unitPriceCents: 100_000, vatRate: 20, vatCategory: "S" }],
      attestationTvaFournie: true,
      ...overrides,
    })
    .expect(201);
  return res.body as { id: string };
}

function emettre(cookie: string, id: string, issuedDate: string) {
  return request(serveurTest(app))
    .post(`/api/factures/${id}/emettre`)
    .set("Cookie", cookie)
    .send({ issuedDate, dueDate: "2026-09-30" });
}

beforeAll(async () => {
  const tenantA = await createTestTenant("E-Reporting Tenant A");
  const tenantB = await createTestTenant("E-Reporting Tenant B");
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;
  tenantIds.push(tenantA.id, tenantB.id);

  const emailA = `er-owner-a-${Date.now()}@test.nodaq`;
  const emailB = `er-owner-b-${Date.now()}@test.nodaq`;
  emails.push(emailA, emailB);

  const ownerA = await createTestUser(emailA);
  await createTestMembership(ownerA.id, tenantA.id, "OWNER");
  cookieA = cookieHeader((await createTestSession(ownerA.id, tenantA.id)).id);

  const ownerB = await createTestUser(emailB);
  await createTestMembership(ownerB.id, tenantB.id, "OWNER");
  cookieB = cookieHeader((await createTestSession(ownerB.id, tenantB.id)).id);

  await request(serveurTest(app))
    .patch("/api/parametres")
    .set("Cookie", cookieA)
    .send({ "company.siret": "81234567600009", "company.raison_sociale": "E-Reporting Corp" })
    .expect(200);

  // Deux factures ÉMISES dans la période [2026-08-01, 2026-08-31] : 1000€ + 1000€ HT.
  const f1 = await createBrouillon(cookieA);
  await emettre(cookieA, f1.id, "2026-08-10").expect(200);
  const f2 = await createBrouillon(cookieA);
  await emettre(cookieA, f2.id, "2026-08-20").expect(200);

  // Une facture ÉMISE HORS période (septembre).
  const f3 = await createBrouillon(cookieA, { issuedDate: "2026-09-15" });
  await emettre(cookieA, f3.id, "2026-09-15").expect(200);

  // Un brouillon jamais émis — ne doit compter NULLE PART, pas même "hors période".
  await createBrouillon(cookieA);
}, 60_000);

afterAll(async () => {
  for (const tbl of ["archived_pdfs", "activity", "avoirs", "facture_sequences", "factures", "pa_transmissions"]) {
    await adminPool.query(`DELETE FROM ${tbl} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  }
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("a — aperçu de l'agrégat", () => {
  test("compte exactement les 2 factures émises DANS la période, exclut le brouillon et la facture hors période", async () => {
    const res = await request(serveurTest(app))
      .get("/api/e-reporting/apercu")
      .query({ periodeDebut: "2026-08-01", periodeFin: "2026-08-31" })
      .set("Cookie", cookieA)
      .expect(200);

    expect(res.body.transactionCount).toBe(2);
    expect(res.body.totalCents).toBe(200_000); // 2 × 1000€ HT
    expect(res.body.outOfPeriodCount).toBe(1); // la facture de septembre
    expect(res.body.vatDerivable).toBe(false);
    expect(res.body.currency).toBe("EUR");
  });

  test("une période inversée est rejetée (400), pas silencieusement acceptée", async () => {
    await request(serveurTest(app))
      .get("/api/e-reporting/apercu")
      .query({ periodeDebut: "2026-08-31", periodeFin: "2026-08-01" })
      .set("Cookie", cookieA)
      .expect(400);
  });

  test("isolation : le tenant B ne voit aucune des factures du tenant A", async () => {
    const res = await request(serveurTest(app))
      .get("/api/e-reporting/apercu")
      .query({ periodeDebut: "2026-08-01", periodeFin: "2026-08-31" })
      .set("Cookie", cookieB)
      .expect(200);
    expect(res.body.transactionCount).toBe(0);
    expect(res.body.totalCents).toBe(0);
  });
});

describe("b — déclaration : refus explicite sans plateforme agréée configurée", () => {
  test("503, pas une transmission silencieusement ignorée", async () => {
    const res = await request(serveurTest(app))
      .post("/api/e-reporting/declarer")
      .set("Cookie", cookieA)
      .send({ periodeDebut: "2026-08-01", periodeFin: "2026-08-31", tvaDeclareeCents: 40_000 })
      .expect(503);
    expect(res.body.variableManquante).toBe("PA_BASE_URL");
  });

  test("aucune ligne pa_transmissions n'est écrite quand la transmission n'a jamais été tentée", async () => {
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM pa_transmissions WHERE tenant_id = $1`,
      [tenantAId],
    );
    expect(rows[0]?.n).toBe(0);
  });

  test("un corps invalide (TVA négative) est rejeté (400) avant tout appel PA", async () => {
    await request(serveurTest(app))
      .post("/api/e-reporting/declarer")
      .set("Cookie", cookieA)
      .send({ periodeDebut: "2026-08-01", periodeFin: "2026-08-31", tvaDeclareeCents: -1 })
      .expect(400);
  });
});
