/**
 * GET /previsionnel-tresorerie — assemblage des données réelles pour le
 * moteur pur (PR 3/3, US-A3.5).
 *
 * Ce que ces tests protègent :
 *   a. pas de compte bancaire connecté → 200 avec donneesInsuffisantes, jamais une erreur ;
 *   b. peuplé (solde + facture + échéance + charge) → le calcul de bout en
 *      bout via la vraie route, pas seulement la fonction pure ;
 *   c. financierOnly : MEMBER → 403.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
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

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

async function connecterBanque(tenantId: string, soldeCents: number): Promise<void> {
  const connectionId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO bank_connections (id, tenant_id, bridge_user_uuid, statut) VALUES ($1, $2::uuid, $3, 'connecte')`,
    [connectionId, tenantId, `bu-${crypto.randomUUID()}`],
  );
  await adminPool.query(
    `INSERT INTO bank_accounts (id, tenant_id, connection_id, label, balance_cents) VALUES ($1, $2::uuid, $3, 'Compte courant', $4)`,
    [crypto.randomUUID(), tenantId, connectionId, soldeCents],
  );
}

describe("a — pas de compte bancaire connecté", () => {
  test("200 avec donneesInsuffisantes, jamais une erreur", async () => {
    const tenant = await createTestTenant("Prévisionnel A");
    cleanupTenantIds.push(tenant.id);
    const email = `previsionnel-a-${Date.now()}@test.nodaq`;
    cleanupEmails.push(email);
    const owner = await createTestUser(email);
    await createTestMembership(owner.id, tenant.id, "OWNER");
    const cookie = cookieHeader((await createTestSession(owner.id, tenant.id)).id);

    const res = await request(serveurTest(app)).get("/api/previsionnel-tresorerie").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.donneesInsuffisantes).toBe(true);
    expect(res.body.soldeDepartCents).toBeNull();
    expect(res.body.semaines).toHaveLength(8);
  });
});

describe("b — peuplé, calcul de bout en bout", () => {
  let cookie: string;
  let tenantId: string;

  beforeAll(async () => {
    const tenant = await createTestTenant("Prévisionnel B");
    cleanupTenantIds.push(tenant.id);
    tenantId = tenant.id;
    const email = `previsionnel-b-${Date.now()}@test.nodaq`;
    cleanupEmails.push(email);
    const owner = await createTestUser(email);
    await createTestMembership(owner.id, tenant.id, "OWNER");
    cookie = cookieHeader((await createTestSession(owner.id, tenant.id)).id);

    await connecterBanque(tenantId, 500_000);

    const dansUneSemaine = new Date();
    dansUneSemaine.setDate(dansUneSemaine.getDate() + 3);
    const dueDate = dansUneSemaine.toISOString().slice(0, 10);

    // Facture impayée (EMISE) échéant dans la fenêtre.
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents, due_date, issued_date, statut, settled, created_at)
       VALUES ($1, $2::uuid, 'F-PREV-1', 'Client Prévisionnel', 100000, $3, $3, 'EMISE', false, now())`,
      [crypto.randomUUID(), tenantId, dueDate],
    );

    // Échéance À_VENIR chiffrée dans la fenêtre.
    await adminPool.query(
      `INSERT INTO echeances (id, tenant_id, label, type, due_date, estimated_cents, status) VALUES ($1, $2::uuid, 'TVA prévisionnel', 'TVA', $3, 45000, 'A_VENIR')`,
      [crypto.randomUUID(), tenantId, dueDate],
    );

    // Charge récurrente active, ancrée aujourd'hui — cadence trimestrielle
    // pour garantir EXACTEMENT une occurrence dans une fenêtre de 8 semaines
    // (une charge mensuelle ancrée aujourd'hui en produirait DEUX : celle du
    // jour même et celle du mois suivant, toutes deux à moins de 56 jours).
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await adminPool.query(
      `INSERT INTO charges_recurrentes (id, tenant_id, label, category, cadence, start_date, amount_cents, active) VALUES ($1, $2::uuid, 'Loyer prévisionnel', 'LOYER', 'trimestriel', $3, 80000, true)`,
      [crypto.randomUUID(), tenantId, aujourdhui],
    );
  }, 30_000);

  test("le solde de départ est le vrai solde bancaire", async () => {
    const res = await request(serveurTest(app)).get("/api/previsionnel-tresorerie").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.donneesInsuffisantes).toBe(false);
    expect(res.body.soldeDepartCents).toBe(500_000);
  });

  test("la facture, l'échéance et la charge apparaissent dans les totaux", async () => {
    const res = await request(serveurTest(app)).get("/api/previsionnel-tresorerie").set("Cookie", cookie);
    const totalEntrees = res.body.semaines.reduce((a: number, s: { entreesCents: number }) => a + s.entreesCents, 0);
    const totalSorties = res.body.semaines.reduce((a: number, s: { sortiesCents: number }) => a + s.sortiesCents, 0);
    expect(totalEntrees).toBe(100_000);
    expect(totalSorties).toBe(45_000 + 80_000);
  });

  test("le solde de la dernière semaine reflète le cumul", async () => {
    const res = await request(serveurTest(app)).get("/api/previsionnel-tresorerie").set("Cookie", cookie);
    const derniere = res.body.semaines[res.body.semaines.length - 1];
    expect(derniere.soldeFinCents).toBe(500_000 + 100_000 - 45_000 - 80_000);
  });
});

describe("c — financierOnly", () => {
  test("MEMBER → 403", async () => {
    const tenant = await createTestTenant("Prévisionnel C");
    cleanupTenantIds.push(tenant.id);
    const email = `previsionnel-c-${Date.now()}@test.nodaq`;
    cleanupEmails.push(email);
    const member = await createTestUser(email);
    await createTestMembership(member.id, tenant.id, "MEMBER");
    const cookie = cookieHeader((await createTestSession(member.id, tenant.id)).id);

    const res = await request(serveurTest(app)).get("/api/previsionnel-tresorerie").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });
});

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);
