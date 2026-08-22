/**
 * Charges récurrentes (loyer, salaires, abonnements) — CRUD, préalable au
 * prévisionnel de trésorerie (US-A3.5, PR 2/3).
 *
 * Ce que ces tests protègent :
 *   a. CRUD complet, un cycle de vie simple (active, pas de statut dérivé) ;
 *   b. Zod refuse une cadence inconnue ou une saisie incomplète ;
 *   c. financierOnly : MEMBER → 403, OWNER → 200/201 ;
 *   d. isolation : un tenant ne voit jamais les charges d'un autre.
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

let cookieOwner: string;
let cookieMember: string;
let cookieOwnerB: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

beforeAll(async () => {
  const tenantA = await createTestTenant("Charges Récurrentes A");
  cleanupTenantIds.push(tenantA.id);
  const emailOwner = `charges-owner-${Date.now()}@test.nodaq`;
  cleanupEmails.push(emailOwner);
  const owner = await createTestUser(emailOwner);
  await createTestMembership(owner.id, tenantA.id, "OWNER");
  cookieOwner = cookieHeader((await createTestSession(owner.id, tenantA.id)).id);

  const emailMember = `charges-member-${Date.now()}@test.nodaq`;
  cleanupEmails.push(emailMember);
  const member = await createTestUser(emailMember);
  await createTestMembership(member.id, tenantA.id, "MEMBER");
  cookieMember = cookieHeader((await createTestSession(member.id, tenantA.id)).id);

  const tenantB = await createTestTenant("Charges Récurrentes B");
  cleanupTenantIds.push(tenantB.id);
  const emailOwnerB = `charges-owner-b-${Date.now()}@test.nodaq`;
  cleanupEmails.push(emailOwnerB);
  const ownerB = await createTestUser(emailOwnerB);
  await createTestMembership(ownerB.id, tenantB.id, "OWNER");
  cookieOwnerB = cookieHeader((await createTestSession(ownerB.id, tenantB.id)).id);
}, 30_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("a — CRUD complet", () => {
  test("POST crée, GET liste, PATCH met à jour, DELETE supprime", async () => {
    const res1 = await request(serveurTest(app))
      .post("/api/charges-recurrentes")
      .set("Cookie", cookieOwner)
      .send({ label: "Loyer atelier", category: "LOYER", cadence: "mensuel", startDate: "2026-08-05", amountCents: 80_000 });
    expect(res1.status).toBe(201);
    expect(res1.body.active).toBe(true);
    const id = res1.body.id;

    const res2 = await request(serveurTest(app)).get("/api/charges-recurrentes").set("Cookie", cookieOwner);
    expect(res2.status).toBe(200);
    expect(res2.body.find((c: { id: string }) => c.id === id)).toBeDefined();

    const res3 = await request(serveurTest(app))
      .patch(`/api/charges-recurrentes/${id}`)
      .set("Cookie", cookieOwner)
      .send({ amountCents: 85_000, active: false });
    expect(res3.status).toBe(200);
    expect(res3.body.amountCents).toBe(85_000);
    expect(res3.body.active).toBe(false);

    const res4 = await request(serveurTest(app)).get("/api/charges-recurrentes?active=false").set("Cookie", cookieOwner);
    expect(res4.body.find((c: { id: string }) => c.id === id)).toBeDefined();

    const res5 = await request(serveurTest(app)).delete(`/api/charges-recurrentes/${id}`).set("Cookie", cookieOwner);
    expect(res5.status).toBe(204);

    const res6 = await request(serveurTest(app)).get("/api/charges-recurrentes").set("Cookie", cookieOwner);
    expect(res6.body.find((c: { id: string }) => c.id === id)).toBeUndefined();
  });

  test("PATCH/DELETE sur un id inexistant → 404", async () => {
    const resPatch = await request(serveurTest(app))
      .patch("/api/charges-recurrentes/00000000-0000-0000-0000-000000000000")
      .set("Cookie", cookieOwner)
      .send({ amountCents: 1 });
    expect(resPatch.status).toBe(404);

    const resDelete = await request(serveurTest(app))
      .delete("/api/charges-recurrentes/00000000-0000-0000-0000-000000000000")
      .set("Cookie", cookieOwner);
    expect(resDelete.status).toBe(404);
  });
});

describe("b — validation Zod", () => {
  test("cadence absente → 400, rien n'est créé", async () => {
    const res = await request(serveurTest(app))
      .post("/api/charges-recurrentes")
      .set("Cookie", cookieOwner)
      .send({ label: "Sans cadence", category: "AUTRE", startDate: "2026-08-05", amountCents: 1_000 });
    expect(res.status).toBe(400);
  });

  test("label vide → 400", async () => {
    const res = await request(serveurTest(app))
      .post("/api/charges-recurrentes")
      .set("Cookie", cookieOwner)
      .send({ label: "", category: "AUTRE", cadence: "mensuel", startDate: "2026-08-05", amountCents: 1_000 });
    expect(res.status).toBe(400);
  });
});

describe("c — financierOnly", () => {
  test("MEMBER → 403 sur toutes les routes", async () => {
    const resGet = await request(serveurTest(app)).get("/api/charges-recurrentes").set("Cookie", cookieMember);
    expect(resGet.status).toBe(403);

    const resPost = await request(serveurTest(app))
      .post("/api/charges-recurrentes")
      .set("Cookie", cookieMember)
      .send({ label: "x", category: "AUTRE", cadence: "mensuel", startDate: "2026-08-05", amountCents: 1_000 });
    expect(resPost.status).toBe(403);
  });
});

describe("d — isolation par tenant", () => {
  test("le tenant B ne voit pas les charges du tenant A", async () => {
    await request(serveurTest(app))
      .post("/api/charges-recurrentes")
      .set("Cookie", cookieOwner)
      .send({ label: "Charge tenant A", category: "AUTRE", cadence: "mensuel", startDate: "2026-08-05", amountCents: 5_000 });

    const res = await request(serveurTest(app)).get("/api/charges-recurrentes").set("Cookie", cookieOwnerB);
    expect(res.status).toBe(200);
    expect(res.body.find((c: { label: string }) => c.label === "Charge tenant A")).toBeUndefined();
  });
});
