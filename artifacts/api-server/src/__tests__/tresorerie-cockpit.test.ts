/**
 * Trésorerie disponible du cockpit (PR 3/3 du connecteur bancaire Bridge).
 *
 * Ce que ces tests protègent :
 *   a. pas encore connecté (aucune ligne bank_accounts) → null, jamais 0 —
 *      même doctrine que incidentsFacturationCount (maskFinancialFields.ts).
 *   b. connecté → la somme réelle des soldes, y compris quand elle vaut 0
 *      (une ligne existe : ce n'est plus « pas connecté »).
 *   c. isolation : le solde d'un tenant ne fuit jamais chez un autre.
 *   d. masquage : un MEMBER ne voit jamais le solde, connecté ou non — même
 *      règle que chiffreAffairesMois/totalImpayeCents.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, createTestUser, createTestMembership, completeMfaForRegisteredOwner } from "./helpers";

let cookieOwnerA: string;
let cookieMemberA: string;
let cookieOwnerB: string;
let tenantA: string;
let tenantB: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

/** Pose une connexion Bridge « connectée » avec un ou plusieurs comptes. */
async function connecterBanque(tenantId: string, soldesCents: number[]): Promise<void> {
  const connectionId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO bank_connections (id, tenant_id, bridge_user_uuid, statut)
     VALUES ($1, $2::uuid, $3, 'connecte')`,
    [connectionId, tenantId, `bu-${crypto.randomUUID()}`],
  );
  for (const solde of soldesCents) {
    await adminPool.query(
      `INSERT INTO bank_accounts (id, tenant_id, connection_id, label, balance_cents, devise)
       VALUES ($1, $2::uuid, $3, 'Compte courant', $4, 'EUR')`,
      [crypto.randomUUID(), tenantId, connectionId, solde],
    );
  }
}

beforeAll(async () => {
  for (const [nom, cible] of [["a", "A"], ["b", "B"]] as const) {
    const email = `tresorerie-${nom}-${Date.now()}@test.nodaq`;
    cleanupEmails.push(email);
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ email, password: "test-pass-1234", nom: `Patron ${cible}`, tenantNom: `Tenant ${cible}` })
      .expect(201);
    await completeMfaForRegisteredOwner(reg.body.userId);
    const cookie = reg.headers["set-cookie"]?.[0] ?? "";
    const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    if (cible === "A") { cookieOwnerA = cookie; tenantA = me.tenantId; }
    else { cookieOwnerB = cookie; tenantB = me.tenantId; }
    cleanupTenantIds.push(me.tenantId);
  }

  const emailMember = `tresorerie-member-${Date.now()}@test.nodaq`;
  cleanupEmails.push(emailMember);
  const utilisateurMembre = await createTestUser(emailMember);
  await createTestMembership(utilisateurMembre.id, tenantA, "MEMBER");
  const connexion = await request(app)
    .post("/api/auth/login")
    .send({ email: emailMember, password: utilisateurMembre.password })
    .expect(200);
  cookieMemberA = connexion.headers["set-cookie"]?.[0] ?? "";
  if (!cookieMemberA) throw new Error("le MEMBER n'a pas reçu de cookie");
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("a — pas encore connecté", () => {
  test("aucune ligne bank_accounts → treasuryBalanceCents est null, pas 0", async () => {
    const { body } = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookieOwnerB)
      .expect(200);
    expect(body.treasuryBalanceCents).toBeNull();
  });
});

describe("b — connecté", () => {
  test("la somme des soldes réels est renvoyée", async () => {
    await connecterBanque(tenantA, [123_456, 78_900]);

    const { body } = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(body.treasuryBalanceCents).toBe(202_356);
  });
});

describe("c — isolation", () => {
  test("le solde du tenant A n'apparaît pas chez le tenant B", async () => {
    const { body } = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookieOwnerB)
      .expect(200);
    expect(body.treasuryBalanceCents).toBeNull();
  });
});

describe("d — masquage financier", () => {
  test("un MEMBER ne voit jamais le solde, même connecté", async () => {
    const { body } = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookieMemberA)
      .expect(200);
    expect(body.treasuryBalanceCents).toBeNull();
  });
});
