/**
 * Aucune validation sur les montants négatifs — bug confirmé en UAT sur
 * `estimatedValueCents` : "-500" accepté sans erreur, persisté tel quel en
 * base, et faisait passer le KPI "Valeur du pipeline" en négatif. Le champ
 * n'avait de contrainte `min` ni côté Zod ni côté formulaire — un `min="0"`
 * HTML seul est contournable au clavier, la garde doit être serveur.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  createTestTenant,
  createTestUser,
  createTestMembership,
  createTestSession,
  cookieHeader,
  cleanupTenants,
  cleanupUsers,
  serveurTest,
} from "./helpers";

let cookie: string;
const tenantIds: string[] = [];
const emails: string[] = [];

beforeAll(async () => {
  const tenant = await createTestTenant("Prospects CRM Tenant");
  tenantIds.push(tenant.id);
  const email = `prospects-crm-${Date.now()}@test.nodaq`;
  emails.push(email);
  const user = await createTestUser(email);
  await createTestMembership(user.id, tenant.id, "OWNER");
  const session = await createTestSession(user.id, tenant.id);
  cookie = cookieHeader(session.id);
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

describe("a — estimatedValueCents n'accepte jamais une valeur négative", () => {
  test("POST /api/prospects avec une valeur négative → 400, rien n'est créé", async () => {
    const res = await request(serveurTest(app))
      .post("/api/prospects")
      .set("Cookie", cookie)
      .send({ name: "Prospect négatif", estimatedValueCents: -50000 });

    expect(res.status).toBe(400);

    const list = await request(serveurTest(app)).get("/api/prospects").set("Cookie", cookie);
    expect(list.body.find((p: { name: string }) => p.name === "Prospect négatif")).toBeUndefined();
  });

  test("POST /api/prospects avec une valeur positive ou absente reste accepté", async () => {
    const positif = await request(serveurTest(app))
      .post("/api/prospects")
      .set("Cookie", cookie)
      .send({ name: "Prospect positif", estimatedValueCents: 320000 });
    expect(positif.status).toBe(201);
    expect(positif.body.estimatedValueCents).toBe(320000);

    const absent = await request(serveurTest(app))
      .post("/api/prospects")
      .set("Cookie", cookie)
      .send({ name: "Prospect sans valeur" });
    expect(absent.status).toBe(201);
    expect(absent.body.estimatedValueCents).toBeNull();

    const zero = await request(serveurTest(app))
      .post("/api/prospects")
      .set("Cookie", cookie)
      .send({ name: "Prospect à zéro", estimatedValueCents: 0 });
    expect(zero.status).toBe(201);
    expect(zero.body.estimatedValueCents).toBe(0);
  });

  test("PATCH /api/prospects/:id avec une valeur négative → 400, la valeur existante n'est pas modifiée", async () => {
    const created = await request(serveurTest(app))
      .post("/api/prospects")
      .set("Cookie", cookie)
      .send({ name: "Prospect à corriger", estimatedValueCents: 100000 });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const patch = await request(serveurTest(app))
      .patch(`/api/prospects/${id}`)
      .set("Cookie", cookie)
      .send({ estimatedValueCents: -1 });
    expect(patch.status).toBe(400);

    const reread = await request(serveurTest(app)).get("/api/prospects").set("Cookie", cookie);
    const prospect = reread.body.find((p: { id: string }) => p.id === id);
    expect(prospect.estimatedValueCents).toBe(100000);
  });
});
